import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult, query } from 'express-validator';
import { MasterCrop, MasterProduct, NonPurchaseReason, Sentiment, MasterLanguage } from '../models/MasterData.js';
import { StateLanguageMapping } from '../models/StateLanguageMapping.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';
import {
  assertActiveMasterLanguage,
  assertActiveMasterLanguages,
} from '../utils/masterLanguageValidation.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== CROPS ====================

// @route   GET /api/master-data/crops
// @desc    Get all active crops (for dropdown)
// @access  Private (all authenticated users)
router.get('/crops', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const crops = await MasterCrop.find(query)
      .sort({ name: 1 })
      .select('name isActive');

    res.json({
      success: true,
      data: { crops },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/crops/all
// @desc    Get all crops (including inactive) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.get(
  '/crops/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const crops = await MasterCrop.find().sort({ name: 1 });

      res.json({
        success: true,
        data: { crops },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/crops
// @desc    Create new crop - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.post(
  '/crops',
  requirePermission('master_data.create'),
  [
    body('name').trim().notEmpty().withMessage('Crop name is required'),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { name, isActive = true } = req.body;

      const trimmedName = name.trim();
      if (!trimmedName) {
        const error: AppError = new Error('Crop name cannot be empty');
        error.statusCode = 400;
        throw error;
      }

      // Check if crop already exists (case-insensitive) and is active
      // Escape special regex characters in the name
      const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingActive = await MasterCrop.findOne({ 
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        isActive: true 
      });
      
      if (existingActive) {
        // Active duplicate - conflict (skip during import)
        const error: AppError = new Error('Crop already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const crop = new MasterCrop({
        name: trimmedName,
        isActive,
      });

      try {
        await crop.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          // Check if it's a duplicate name error
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Crop already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Master crop created: ${crop.name} by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'Crop created successfully',
        data: { crop },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/crops/:id
// @desc    Update crop - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.put(
  '/crops/:id',
  requirePermission('master_data.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { name, isActive } = req.body;

      const crop = await MasterCrop.findById(id);
      if (!crop) {
        const error: AppError = new Error('Crop not found');
        error.statusCode = 404;
        throw error;
      }

      if (name) {
        const trimmedName = name.trim();
        if (trimmedName.toLowerCase() !== crop.name.toLowerCase()) {
          // Check if new name already exists as active (case-insensitive)
          // Escape special regex characters in the name
          const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const existingActive = await MasterCrop.findOne({ 
            name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
            isActive: true,
            _id: { $ne: id } // Exclude current record
          });
          if (existingActive) {
            const error: AppError = new Error('Crop name already exists');
            error.statusCode = 409;
            throw error;
          }
          crop.name = trimmedName;
        }
      }

      if (isActive !== undefined) {
        crop.isActive = isActive;
      }

      try {
        await crop.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Crop name already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Master crop updated: ${crop.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Crop updated successfully',
        data: { crop },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/crops/bulk
// @desc    Bulk delete crops (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
// NOTE: Must be defined BEFORE /crops/:id to avoid route conflict
router.delete(
  '/crops/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await MasterCrop.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} crops by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} crop(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/crops/:id
// @desc    Delete crop (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.delete(
  '/crops/:id',
  requirePermission('master_data.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      // Prevent "bulk" from being treated as an ID
      if (id === 'bulk') {
        const error: AppError = new Error('Invalid route');
        error.statusCode = 404;
        throw error;
      }

      const crop = await MasterCrop.findById(id);
      if (!crop) {
        const error: AppError = new Error('Crop not found');
        error.statusCode = 404;
        throw error;
      }

      // Soft delete
      crop.isActive = false;
      await crop.save();

      logger.info(`Master crop deactivated: ${crop.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Crop deactivated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== PRODUCTS ====================

// @route   GET /api/master-data/products
// @desc    Get all active products (for dropdown)
// @access  Private (all authenticated users)
router.get('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const products = await MasterProduct.find(query)
      .sort({ name: 1 })
      .select('name isActive');

    res.json({
      success: true,
      data: { products },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/products/all
// @desc    Get all products (including inactive) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.get(
  '/products/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const products = await MasterProduct.find().sort({ name: 1 });

      res.json({
        success: true,
        data: { products },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/products
// @desc    Create new product - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.post(
  '/products',
  requirePermission('master_data.create'),
  [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('category').optional().trim(),
    body('segment').optional().trim(),
    body('subcategory').optional().trim(),
    body('productCode').optional().trim(),
    body('focusProducts').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { name, category, segment, subcategory, productCode, focusProducts = false, isActive = true } = req.body;

      // Check if product already exists (active)
      const existingActive = await MasterProduct.findOne({ name, isActive: true });
      if (existingActive) {
        // Active duplicate - conflict (skip during import)
        const error: AppError = new Error('Product already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const product = new MasterProduct({
        name,
        category,
        segment,
        subcategory,
        productCode,
        focusProducts,
        isActive,
      });

      try {
        await product.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Product already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Master product created: ${product.name} by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/products/:id
// @desc    Update product - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.put(
  '/products/:id',
  requirePermission('master_data.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('category').optional().trim(),
    body('segment').optional().trim(),
    body('subcategory').optional().trim(),
    body('productCode').optional().trim(),
    body('focusProducts').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { name, category, segment, subcategory, productCode, focusProducts, isActive } = req.body;

      const product = await MasterProduct.findById(id);
      if (!product) {
        const error: AppError = new Error('Product not found');
        error.statusCode = 404;
        throw error;
      }

      if (name && name !== product.name) {
        // Check if new name already exists as active
        const existingActive = await MasterProduct.findOne({ 
          name,
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('Product name already exists');
          error.statusCode = 409;
          throw error;
        }
        product.name = name;
      }

      if (category !== undefined) product.category = category;
      if (segment !== undefined) product.segment = segment;
      if (subcategory !== undefined) product.subcategory = subcategory;
      if (productCode !== undefined) product.productCode = productCode;
      if (focusProducts !== undefined) product.focusProducts = focusProducts;
      if (isActive !== undefined) product.isActive = isActive;

      try {
        await product.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Product name already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Master product updated: ${product.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/products/bulk
// @desc    Bulk delete products (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
// NOTE: Must be defined BEFORE /products/:id to avoid route conflict
router.delete(
  '/products/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await MasterProduct.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} products by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} product(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/products/:id
// @desc    Delete product (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin, Core Sales Head)
router.delete(
  '/products/:id',
  requirePermission('master_data.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      // Prevent "bulk" from being treated as an ID
      if (id === 'bulk') {
        const error: AppError = new Error('Invalid route');
        error.statusCode = 404;
        throw error;
      }

      const product = await MasterProduct.findById(id);
      if (!product) {
        const error: AppError = new Error('Product not found');
        error.statusCode = 404;
        throw error;
      }

      // Soft delete
      product.isActive = false;
      await product.save();

      logger.info(`Master product deactivated: ${product.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Product deactivated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== NON-PURCHASE REASONS ====================

// @route   GET /api/master-data/non-purchase-reasons
// @desc    Get all active non-purchase reasons (for dropdown)
// @access  Private (all authenticated users)
router.get('/non-purchase-reasons', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const reasons = await NonPurchaseReason.find(query)
      .sort({ displayOrder: 1, name: 1 })
      .select('name displayOrder isActive');

    res.json({
      success: true,
      data: { reasons },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/non-purchase-reasons/all
// @desc    Get all non-purchase reasons (including inactive) - Admin only
// @access  Private (MIS Admin)
router.get(
  '/non-purchase-reasons/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reasons = await NonPurchaseReason.find().sort({ displayOrder: 1, name: 1 });

      res.json({
        success: true,
        data: { reasons },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/non-purchase-reasons
// @desc    Create new non-purchase reason - Admin only
// @access  Private (MIS Admin)
router.post(
  '/non-purchase-reasons',
  requirePermission('master_data.create'),
  [
    body('name').trim().notEmpty().withMessage('Reason name is required'),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { name, displayOrder = 0, isActive = true } = req.body;

      // Check if reason already exists (active)
      const existingActive = await NonPurchaseReason.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        isActive: true 
      });
      if (existingActive) {
        const error: AppError = new Error('Non-purchase reason already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const reason = new NonPurchaseReason({
        name,
        displayOrder,
        isActive,
      });

      try {
        await reason.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Non-purchase reason already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Non-purchase reason created: ${reason.name} by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'Non-purchase reason created successfully',
        data: { reason },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/non-purchase-reasons/:id
// @desc    Update non-purchase reason - Admin only
// @access  Private (MIS Admin)
router.put(
  '/non-purchase-reasons/:id',
  requirePermission('master_data.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { name, displayOrder, isActive } = req.body;

      const reason = await NonPurchaseReason.findById(id);
      if (!reason) {
        const error: AppError = new Error('Non-purchase reason not found');
        error.statusCode = 404;
        throw error;
      }

      if (name && name.toLowerCase() !== reason.name.toLowerCase()) {
        // Check if new name already exists as active (case-insensitive)
        const existingActive = await NonPurchaseReason.findOne({ 
          name: { $regex: new RegExp(`^${name}$`, 'i') },
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('Non-purchase reason name already exists');
          error.statusCode = 409;
          throw error;
        }
        reason.name = name;
      }

      if (displayOrder !== undefined) {
        reason.displayOrder = displayOrder;
      }

      if (isActive !== undefined) {
        reason.isActive = isActive;
      }

      try {
        await reason.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Non-purchase reason name already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Non-purchase reason updated: ${reason.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Non-purchase reason updated successfully',
        data: { reason },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== SENTIMENTS ====================

// @route   GET /api/master-data/sentiments
// @desc    Get all active sentiments (for dropdown)
// @access  Private (all authenticated users)
router.get('/sentiments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const sentiments = await Sentiment.find(query)
      .sort({ displayOrder: 1, name: 1 })
      .select('name colorClass icon displayOrder isActive');

    res.json({
      success: true,
      data: { sentiments },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/sentiments/all
// @desc    Get all sentiments (including inactive) - Admin only
// @access  Private (MIS Admin)
router.get(
  '/sentiments/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sentiments = await Sentiment.find().sort({ displayOrder: 1, name: 1 });

      res.json({
        success: true,
        data: { sentiments },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/sentiments
// @desc    Create new sentiment - Admin only
// @access  Private (MIS Admin)
router.post(
  '/sentiments',
  requirePermission('master_data.create'),
  [
    body('name').trim().notEmpty().withMessage('Sentiment name is required'),
    body('colorClass').optional().trim(),
    body('icon').optional().trim(),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { name, colorClass, icon, displayOrder = 0, isActive = true } = req.body;

      // Check if sentiment already exists (active)
      const existingActive = await Sentiment.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        isActive: true 
      });
      if (existingActive) {
        const error: AppError = new Error('Sentiment already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const sentiment = new Sentiment({
        name,
        colorClass: colorClass || 'bg-slate-100 text-slate-800',
        icon: icon || 'circle',
        displayOrder,
        isActive,
      });

      try {
        await sentiment.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Sentiment already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Sentiment created: ${sentiment.name} by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'Sentiment created successfully',
        data: { sentiment },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/sentiments/:id
// @desc    Update sentiment - Admin only
// @access  Private (MIS Admin)
router.put(
  '/sentiments/:id',
  requirePermission('master_data.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('colorClass').optional().trim(),
    body('icon').optional().trim(),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { name, colorClass, icon, displayOrder, isActive } = req.body;

      const sentiment = await Sentiment.findById(id);
      if (!sentiment) {
        const error: AppError = new Error('Sentiment not found');
        error.statusCode = 404;
        throw error;
      }

      if (name && name.toLowerCase() !== sentiment.name.toLowerCase()) {
        // Check if new name already exists as active (case-insensitive)
        const existingActive = await Sentiment.findOne({ 
          name: { $regex: new RegExp(`^${name}$`, 'i') },
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('Sentiment name already exists');
          error.statusCode = 409;
          throw error;
        }
        sentiment.name = name;
      }

      if (colorClass !== undefined) sentiment.colorClass = colorClass;
      if (icon !== undefined) sentiment.icon = icon;
      if (displayOrder !== undefined) sentiment.displayOrder = displayOrder;
      if (isActive !== undefined) sentiment.isActive = isActive;

      try {
        await sentiment.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Sentiment name already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Sentiment updated: ${sentiment.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Sentiment updated successfully',
        data: { sentiment },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== STATE-LANGUAGE MAPPING ====================

// @route   GET /api/master-data/state-languages
// @desc    Get all active state-language mappings (for dropdown)
// @access  Private (all authenticated users)
router.get('/state-languages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const mappings = await StateLanguageMapping.find(query)
      .sort({ state: 1 })
      .select('state primaryLanguage secondaryLanguages isActive');

    res.json({
      success: true,
      data: { mappings },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/state-languages/all
// @desc    Get all state-language mappings (including inactive) - Admin only
// @access  Private (MIS Admin)
router.get(
  '/state-languages/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mappings = await StateLanguageMapping.find().sort({ state: 1 });

      res.json({
        success: true,
        data: { mappings },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/state-languages
// @desc    Create new state-language mapping - Admin only
// @access  Private (MIS Admin)
router.post(
  '/state-languages',
  requirePermission('master_data.create'),
  [
    body('state').trim().notEmpty().withMessage('State name is required'),
    body('primaryLanguage').trim().notEmpty().withMessage('Primary language is required'),
    body('secondaryLanguages').optional().isArray(),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { state, primaryLanguage, secondaryLanguages = [], isActive = true } = req.body;

      const normalizedPrimary = await assertActiveMasterLanguage(primaryLanguage, 'Primary language');
      const normalizedSecondary = await assertActiveMasterLanguages(
        secondaryLanguages,
        'Secondary language'
      ).then((langs) => langs.filter((lang) => lang.toLowerCase() !== normalizedPrimary.toLowerCase()));

      // Check if state already exists (active)
      const existingActive = await StateLanguageMapping.findOne({ 
        state: { $regex: new RegExp(`^${state}$`, 'i') },
        isActive: true 
      });
      if (existingActive) {
        const error: AppError = new Error('State mapping already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const mapping = new StateLanguageMapping({
        state,
        primaryLanguage: normalizedPrimary,
        secondaryLanguages: normalizedSecondary,
        isActive,
      });

      try {
        await mapping.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.state) {
            const error: AppError = new Error('State mapping already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`State-language mapping created: ${mapping.state} by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'State-language mapping created successfully',
        data: { mapping },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/state-languages/:id
// @desc    Update state-language mapping - Admin only
// @access  Private (MIS Admin)
router.put(
  '/state-languages/:id',
  requirePermission('master_data.update'),
  [
    body('state').optional().trim().notEmpty(),
    body('primaryLanguage').optional().trim().notEmpty(),
    body('secondaryLanguages').optional().isArray(),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { state, primaryLanguage, secondaryLanguages, isActive } = req.body;

      const mapping = await StateLanguageMapping.findById(id);
      if (!mapping) {
        const error: AppError = new Error('State-language mapping not found');
        error.statusCode = 404;
        throw error;
      }

      if (state && state.toLowerCase() !== mapping.state.toLowerCase()) {
        // Check if new state already exists as active (case-insensitive)
        const existingActive = await StateLanguageMapping.findOne({ 
          state: { $regex: new RegExp(`^${state}$`, 'i') },
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('State mapping already exists');
          error.statusCode = 409;
          throw error;
        }
        mapping.state = state;
      }

      if (primaryLanguage !== undefined) {
        mapping.primaryLanguage = await assertActiveMasterLanguage(primaryLanguage, 'Primary language');
      }
      if (secondaryLanguages !== undefined) {
        const normalizedSecondary = await assertActiveMasterLanguages(
          secondaryLanguages,
          'Secondary language'
        );
        mapping.secondaryLanguages = normalizedSecondary.filter(
          (lang) => lang.toLowerCase() !== mapping.primaryLanguage.toLowerCase()
        );
      }
      if (isActive !== undefined) mapping.isActive = isActive;

      try {
        await mapping.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.state) {
            const error: AppError = new Error('State mapping already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`State-language mapping updated: ${mapping.state} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'State-language mapping updated successfully',
        data: { mapping },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== LANGUAGES ====================

// @route   GET /api/master-data/languages
// @desc    Get all active languages (for dropdown)
// @access  Private (all authenticated users)
router.get('/languages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const query: any = {};
    
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const languages = await MasterLanguage.find(query)
      .sort({ displayOrder: 1, name: 1 })
      .select('name code displayOrder isActive');

    res.json({
      success: true,
      data: { languages },
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/master-data/languages/all
// @desc    Get all languages (including inactive) - Admin only
// @access  Private (MIS Admin)
router.get(
  '/languages/all',
  requirePermission('master_data.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const languages = await MasterLanguage.find().sort({ displayOrder: 1, name: 1 });

      res.json({
        success: true,
        data: { languages },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/master-data/languages
// @desc    Create new language - Admin only
// @access  Private (MIS Admin)
router.post(
  '/languages',
  requirePermission('master_data.create'),
  [
    body('name').trim().notEmpty().withMessage('Language name is required'),
    body('code').trim().notEmpty().withMessage('Language code is required'),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { name, code, displayOrder = 0, isActive = true } = req.body;

      const codeUpper = code.toUpperCase();
      
      // Check if language already exists by name (active)
      const existingByNameActive = await MasterLanguage.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        isActive: true 
      });
      if (existingByNameActive) {
        const error: AppError = new Error('Language with this name already exists');
        error.statusCode = 409;
        throw error;
      }

      // Check if language already exists by code (active)
      const existingByCodeActive = await MasterLanguage.findOne({ code: codeUpper, isActive: true });
      if (existingByCodeActive) {
        const error: AppError = new Error('Language with this code already exists');
        error.statusCode = 409;
        throw error;
      }

      // Don't reactivate inactive records - create new record from import file
      // This ensures imports create exactly what's in the file

      const language = new MasterLanguage({
        name,
        code: codeUpper,
        displayOrder,
        isActive,
      });

      try {
        await language.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen if unique index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Language with this name already exists');
            error.statusCode = 409;
            throw error;
          }
          if (saveError.keyPattern?.code) {
            const error: AppError = new Error('Language with this code already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Language created: ${language.name} (${language.code}) by ${(req as AuthRequest).user.email}`);

      res.status(201).json({
        success: true,
        message: 'Language created successfully',
        data: { language },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/master-data/languages/:id
// @desc    Update language - Admin only
// @access  Private (MIS Admin)
router.put(
  '/languages/:id',
  requirePermission('master_data.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('code').optional().trim().notEmpty(),
    body('displayOrder').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { id } = req.params;
      const { name, code, displayOrder, isActive } = req.body;

      const language = await MasterLanguage.findById(id);
      if (!language) {
        const error: AppError = new Error('Language not found');
        error.statusCode = 404;
        throw error;
      }

      if (name && name.toLowerCase() !== language.name.toLowerCase()) {
        // Check if new name already exists as active (case-insensitive)
        const existingActive = await MasterLanguage.findOne({ 
          name: { $regex: new RegExp(`^${name}$`, 'i') },
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('Language name already exists');
          error.statusCode = 409;
          throw error;
        }
        language.name = name;
      }

      if (code && code.toUpperCase() !== language.code) {
        // Check if new code already exists as active
        const existingActive = await MasterLanguage.findOne({ 
          code: code.toUpperCase(),
          isActive: true,
          _id: { $ne: id } // Exclude current record
        });
        if (existingActive) {
          const error: AppError = new Error('Language code already exists');
          error.statusCode = 409;
          throw error;
        }
        language.code = code.toUpperCase();
      }

      if (displayOrder !== undefined) language.displayOrder = displayOrder;
      if (isActive !== undefined) language.isActive = isActive;

      try {
        await language.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - fallback if index constraint is violated
        if (saveError.code === 11000) {
          if (saveError.keyPattern?.name) {
            const error: AppError = new Error('Language name already exists');
            error.statusCode = 409;
            throw error;
          }
          if (saveError.keyPattern?.code) {
            const error: AppError = new Error('Language code already exists');
            error.statusCode = 409;
            throw error;
          }
        }
        throw saveError;
      }

      logger.info(`Language updated: ${language.name} by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: 'Language updated successfully',
        data: { language },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== BULK DELETE ENDPOINTS ====================

// @route   DELETE /api/master-data/languages/bulk
// @desc    Bulk delete languages (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin)
router.delete(
  '/languages/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await MasterLanguage.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} languages by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} language(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/sentiments/bulk
// @desc    Bulk delete sentiments (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin)
router.delete(
  '/sentiments/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await Sentiment.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} sentiments by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} sentiment(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/non-purchase-reasons/bulk
// @desc    Bulk delete non-purchase reasons (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin)
router.delete(
  '/non-purchase-reasons/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await NonPurchaseReason.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} non-purchase reasons by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} non-purchase reason(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/master-data/state-languages/bulk
// @desc    Bulk delete state-language mappings (soft delete by setting isActive=false) - Admin only
// @access  Private (MIS Admin)
router.delete(
  '/state-languages/bulk',
  requirePermission('master_data.delete'),
  [
    body('ids').isArray().withMessage('ids must be an array'),
    body('ids.*').isMongoId().withMessage('Each id must be a valid MongoDB ID'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { ids } = req.body;

      const result = await StateLanguageMapping.updateMany(
        { _id: { $in: ids } },
        { $set: { isActive: false } }
      );

      logger.info(`Bulk deactivated ${result.modifiedCount} state-language mappings by ${(req as AuthRequest).user.email}`);

      res.json({
        success: true,
        message: `${result.modifiedCount} state-language mapping(s) deactivated successfully`,
        data: { modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;


