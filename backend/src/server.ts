import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import logger from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

// Load environment variables
// Testing deployment after adding Cloud Build Editor role
// Updated: Trigger redeploy to use updated MONGODB_URI secret (Kweka_Call_Centre)
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'https://cc-ems-dev.web.app',
      'https://cc-ems-dev.firebaseapp.com',
    ];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Role'],
  exposedHeaders: ['X-Active-Role'],
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'EMS Call Centre API is running',
    timestamp: new Date().toISOString(),
  });
});

// Database health check
app.get('/api/health/database', async (req, res) => {
  try {
    const mongoose = await import('mongoose');
    const isConnected = mongoose.default.connection.readyState === 1;
    
    res.json({
      success: isConnected,
      message: isConnected ? 'Database connected' : 'Database disconnected',
      readyState: mongoose.default.connection.readyState,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database health check failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Debug endpoint: Check if admin user exists (public, for debugging)
app.get('/api/debug/admin-exists', async (req, res) => {
  try {
    const mongoose = await import('mongoose');
    const { User } = await import('./models/User.js');
    
    const isConnected = mongoose.default.connection.readyState === 1;
    if (!isConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
        readyState: mongoose.default.connection.readyState,
      });
    }

    // Try multiple email variations
    const emailVariations = ['shubhashish@kweka.ai', 'Shubhashish@kweka.ai', 'SHUBHASHISH@KWEKA.AI'];
    let admin = null;
    let matchedEmail = null;

    for (const email of emailVariations) {
      admin = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
      if (admin) {
        matchedEmail = email;
        break;
      }
    }

    const userCount = await User.countDocuments();
    
    // Test password comparison if user exists
    let passwordTestResult = null;
    if (admin && admin.password) {
      try {
        const { comparePassword } = await import('./utils/password.js');
        const testPassword = 'Admin@123';
        const passwordMatch = await comparePassword(testPassword, admin.password);
        passwordTestResult = {
          testPassword: testPassword,
          passwordExists: !!admin.password,
          passwordLength: admin.password?.length || 0,
          passwordStartsWith: admin.password?.substring(0, 10) || 'N/A',
          passwordHashFormat: admin.password.startsWith('$2') ? 'bcrypt' : 'unknown',
          passwordMatch: passwordMatch,
        };
      } catch (error) {
        passwordTestResult = {
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    } else if (admin && !admin.password) {
      passwordTestResult = {
        error: 'User exists but password field is missing or null',
      };
    }
    
    res.json({
      success: true,
      data: {
        adminExists: !!admin,
        matchedEmail: matchedEmail,
        totalUsers: userCount,
        adminDetails: admin ? {
          email: admin.email,
          role: admin.role,
          isActive: admin.isActive,
          createdAt: admin.createdAt,
          employeeId: admin.employeeId,
        } : null,
        passwordTest: passwordTestResult,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Debug check failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined,
    });
  }
});

// Password reset endpoint (protected with secret token)
app.post('/api/debug/reset-admin-password', async (req, res) => {
  try {
    // Check for secret token in header
    const secretToken = req.headers['x-seed-token'];
    const expectedToken = process.env.ADMIN_SEED_TOKEN || 'change-this-secret-token';
    
    if (secretToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const mongoose = await import('mongoose');
    const { User } = await import('./models/User.js');
    const { hashPassword } = await import('./utils/password.js');
    
    const isConnected = mongoose.default.connection.readyState === 1;
    if (!isConnected) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database not connected' },
      });
    }

    // Find admin user
    const admin = await User.findOne({ email: 'shubhashish@kweka.ai' }).select('+password');
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: { message: 'Admin user not found' },
      });
    }

    // Reset password to Admin@123
    const newPassword = req.body.password || 'Admin@123';
    const hashedPassword = await hashPassword(newPassword);
    
    admin.password = hashedPassword;
    await admin.save();
    
    logger.info(`✅ Admin user password reset via debug endpoint`);

    res.json({
      success: true,
      message: 'Admin password reset successfully',
      data: {
        email: admin.email,
        password: newPassword === 'Admin@123' ? 'Admin@123' : '[CUSTOM]',
      },
    });
  } catch (error) {
    logger.error('Error resetting admin password:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to reset admin password',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Test email endpoint (protected with secret token)
app.post('/api/debug/test-email', async (req, res) => {
  try {
    // Check for secret token in header
    const secretToken = req.headers['x-seed-token'];
    const expectedToken = process.env.ADMIN_SEED_TOKEN || 'change-this-secret-token';
    
    if (secretToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const { to } = req.body;
    if (!to) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email address (to) is required' },
      });
    }

    const { sendEmail, generatePasswordResetEmail } = await import('./utils/email.js');
    
    // Generate a test token
    const testToken = 'test-token-' + Date.now();
    const emailContent = generatePasswordResetEmail(testToken, 'Test User');
    
    const emailSent = await sendEmail({
      to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    if (emailSent) {
      res.json({
        success: true,
        message: `Test email sent successfully to ${to}`,
        data: {
          to,
          resendKeyPresent: !!process.env.RESEND_KEY,
          resendKeyLength: process.env.RESEND_KEY?.length || 0,
          emailFrom: process.env.EMAIL_FROM || process.env.RESEND_FROM || 'onboarding@resend.dev',
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to send test email',
          details: {
            to,
            resendKeyPresent: !!process.env.RESEND_KEY,
            emailFrom: process.env.EMAIL_FROM || process.env.RESEND_FROM || 'onboarding@resend.dev',
          },
        },
      });
    }
  } catch (error) {
    logger.error('Error in test-email:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to send test email',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Admin seed endpoint (protected with secret token)
app.post('/api/debug/seed-admin', async (req, res) => {
  try {
    // Check for secret token in header
    const secretToken = req.headers['x-seed-token'];
    const expectedToken = process.env.ADMIN_SEED_TOKEN || 'change-this-secret-token';
    
    if (secretToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const mongoose = await import('mongoose');
    const { User } = await import('./models/User.js');
    const { hashPassword } = await import('./utils/password.js');
    
    const isConnected = mongoose.default.connection.readyState === 1;
    if (!isConnected) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database not connected' },
      });
    }

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'shubhashish@kweka.ai' });
    if (existingAdmin) {
      return res.json({
        success: true,
        message: 'Admin user already exists',
        data: {
          email: existingAdmin.email,
          role: existingAdmin.role,
          isActive: existingAdmin.isActive,
        },
      });
    }

    // Create admin user
    const hashedPassword = await hashPassword('Admin@123');
    
    const admin = new User({
      name: 'System Administrator',
      email: 'shubhashish@kweka.ai',
      password: hashedPassword,
      employeeId: 'ADMIN001',
      role: 'mis_admin',
      languageCapabilities: ['Hindi', 'English', 'Telugu', 'Marathi', 'Kannada', 'Tamil'],
      assignedTerritories: [],
      isActive: true,
    });

    await admin.save();
    
    logger.info('✅ Admin user created via seed endpoint');

    res.json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    logger.error('Error seeding admin user:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to seed admin user',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Agent seed endpoint (protected with secret token)
app.post('/api/debug/seed-agent', async (req, res) => {
  try {
    // Check for secret token in header
    const secretToken = req.headers['x-seed-token'];
    const expectedToken = process.env.ADMIN_SEED_TOKEN || 'change-this-secret-token';
    
    if (secretToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const mongoose = await import('mongoose');
    const { User } = await import('./models/User.js');
    const { hashPassword } = await import('./utils/password.js');
    
    const isConnected = mongoose.default.connection.readyState === 1;
    if (!isConnected) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database not connected' },
      });
    }

    // Check if agent already exists
    const existingAgent = await User.findOne({ email: 'shubhashish@intelliagri.in' });
    if (existingAgent) {
      return res.json({
        success: true,
        message: 'Agent user already exists',
        data: {
          email: existingAgent.email,
          role: existingAgent.role,
          isActive: existingAgent.isActive,
        },
      });
    }

    // Create agent user
    const hashedPassword = await hashPassword('Admin@123');
    
    const agent = new User({
      name: 'Test Agent',
      email: 'shubhashish@intelliagri.in',
      password: hashedPassword,
      employeeId: 'AGENT001',
      role: 'cc_agent',
      languageCapabilities: ['Hindi', 'English', 'Telugu', 'Marathi', 'Kannada', 'Tamil'],
      assignedTerritories: [],
      isActive: true,
    });

    await agent.save();
    
    logger.info('✅ Agent user created via seed endpoint');

    res.json({
      success: true,
      message: 'Agent user created successfully',
      data: {
        email: agent.email,
        role: agent.role,
      },
    });
  } catch (error) {
    logger.error('Error seeding agent user:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to seed agent user',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Test data generation endpoint (protected with secret token)
app.post('/api/debug/create-test-data', async (req, res) => {
  try {
    // Check for secret token in header
    const secretToken = req.headers['x-seed-token'];
    const expectedToken = process.env.ADMIN_SEED_TOKEN || 'change-this-secret-token';
    
    if (secretToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const mongoose = await import('mongoose');
    const { Farmer } = await import('./models/Farmer.js');
    const { Activity } = await import('./models/Activity.js');
    const { CallTask } = await import('./models/CallTask.js');
    const { User } = await import('./models/User.js');
    const { sampleAndCreateTasks } = await import('./services/samplingService.js');
    
    const isConnected = mongoose.default.connection.readyState === 1;
    if (!isConnected) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database not connected' },
      });
    }

    // Import test data creation logic - Indian data
    const TERRITORIES = [
      'Uttar Pradesh Zone', 'Maharashtra Zone', 'Bihar Zone', 'West Bengal Zone', 'Madhya Pradesh Zone',
      'Tamil Nadu Zone', 'Rajasthan Zone', 'Karnataka Zone', 'Gujarat Zone', 'Andhra Pradesh Zone',
      'Odisha Zone', 'Telangana Zone', 'Kerala Zone', 'Punjab Zone', 'Haryana Zone'
    ];
    const LANGUAGES = ['Hindi', 'English', 'Telugu', 'Marathi', 'Kannada', 'Tamil'];
    const ACTIVITY_TYPES = ['Field Day', 'Group Meeting', 'Demo Visit', 'OFM'];
    const CROPS = ['Rice', 'Wheat', 'Cotton', 'Sugarcane', 'Soybean', 'Maize', 'Groundnut', 'Pulses', 'Jowar', 'Bajra', 'Ragi', 'Mustard'];
    const PRODUCTS = ['NACL Pro', 'NACL Gold', 'NACL Premium', 'NACL Base', 'NACL Bio'];
    
    // Indian officer names
    const INDIAN_OFFICER_NAMES = [
      'Rajesh Kumar Sharma', 'Suresh Singh Yadav', 'Amit Kumar Verma', 'Vinod Kumar Patel',
      'Manoj Kumar Singh', 'Ramesh Kumar Gupta', 'Pradeep Kumar Tiwari', 'Anil Kumar Shukla',
      'Sunil Kumar Pandey', 'Deepak Kumar Mishra', 'Vijay Kumar Dwivedi', 'Ravi Kumar Tripathi',
      'Ajay Kumar Srivastava', 'Sandeep Kumar Dubey', 'Naresh Kumar Agarwal', 'Mahesh Kumar Saxena',
      'Pankaj Kumar Ojha', 'Harish Kumar Varma', 'Dinesh Kumar Jaiswal', 'Mukesh Kumar Gaur',
      'Ashok Kumar Bhatt', 'Nikhil Kumar Joshi', 'Rahul Kumar Agarwal', 'Arun Kumar Mehra',
      'Tarun Kumar Kapoor', 'Varun Kumar Malhotra', 'Karan Kumar Sethi', 'Rohan Kumar Khurana',
      'Aman Kumar Chawla', 'Vishal Kumar Bansal', 'Naveen Kumar Goel', 'Pankaj Kumar Ahuja',
      'Rajesh Kumar Batra', 'Srinivas Kumar Reddy', 'Krishna Kumar Naidu', 'Rama Kumar Goud',
      'Lakshmi Kumar Iyer', 'Sai Kumar Reddy', 'Nagarjuna Kumar Swamy', 'Chandra Kumar Nair',
      'Surya Kumar Patil', 'Venkat Kumar Deshmukh', 'Mohan Kumar Jadhav', 'Raghu Kumar Kulkarni',
      'Siva Kumar Gaikwad', 'Shankar Kumar Pawar', 'Ganesh Kumar More', 'Dilip Kumar Salvi'
    ];

    // Indian village names
    const INDIAN_VILLAGES = [
      'Amarpur', 'Badlapur', 'Chandrapur', 'Dharampur', 'Etah', 'Faridpur', 'Gulabpur',
      'Harihar', 'Indrapur', 'Jagdishpur', 'Kalyanpur', 'Lakshmipur', 'Madhupur', 'Nagarjuna',
      'Ojhar', 'Pratapgarh', 'Rajgarh', 'Sultanpur', 'Tikapur', 'Ujjain', 'Varanasi',
      'Wardha', 'Yavatmal', 'Zirakpur', 'Akola', 'Bhandara', 'Chhindwara', 'Dewas',
      'Etawah', 'Firozabad', 'Gorakhpur', 'Hamirpur', 'Idukki', 'Jalandhar', 'Kanchipuram',
      'Latur', 'Mangalore', 'Nanded', 'Osmanabad', 'Parbhani', 'Ratnagiri', 'Sangli',
      'Thane', 'Udaipur', 'Vidisha', 'Wayanad', 'Yadgir', 'Zunheboto', 'Aizawl', 'Bhopal',
      'Chittorgarh', 'Dharwad', 'Erode', 'Fatehpur', 'Guntur', 'Hubli', 'Imphal', 'Jodhpur',
      'Kolar', 'Ludhiana', 'Mysore', 'Nagpur', 'Ooty', 'Pali', 'Raipur', 'Satara', 'Tumkur'
    ];

    // Indian states and districts
    const INDIAN_STATES = [
      'Uttar Pradesh', 'Maharashtra', 'Bihar', 'West Bengal', 'Madhya Pradesh',
      'Tamil Nadu', 'Rajasthan', 'Karnataka', 'Gujarat', 'Andhra Pradesh',
      'Odisha', 'Telangana', 'Kerala', 'Jharkhand', 'Assam', 'Punjab', 'Haryana'
    ];

    const INDIAN_DISTRICTS: Record<string, string[]> = {
      'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Allahabad', 'Meerut', 'Ghaziabad'],
      'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Thane'],
      'Bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga', 'Arrah'],
      'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Malda'],
      'Madhya Pradesh': ['Bhopal', 'Indore', 'Gwalior', 'Jabalpur', 'Ujjain', 'Raipur', 'Sagar'],
      'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode'],
      'Rajasthan': ['Jaipur', 'Jodhpur', 'Kota', 'Bikaner', 'Ajmer', 'Udaipur', 'Bhilwara'],
      'Karnataka': ['Bangalore', 'Mysore', 'Hubli', 'Mangalore', 'Belgaum', 'Gulbarga', 'Davangere'],
      'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar'],
      'Andhra Pradesh': ['Hyderabad', 'Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati'],
      'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore'],
      'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Mahbubnagar', 'Adilabad'],
      'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Alappuzha', 'Kannur'],
      'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh', 'Deoghar', 'Giridih'],
      'Assam': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur'],
      'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Pathankot', 'Hoshiarpur'],
      'Haryana': ['Gurgaon', 'Faridabad', 'Panipat', 'Ambala', 'Yamunanagar', 'Karnal', 'Rohtak']
    };

    // Indian farmer names by language
    const INDIAN_NAMES: Record<string, string[]> = {
      'Hindi': [
        'Ram Kumar Yadav', 'Shyam Singh', 'Gopal Prasad', 'Mohan Das', 'Ramesh Kumar',
        'Suresh Kumar', 'Anil Kumar', 'Vinod Kumar', 'Prakash Singh', 'Amit Kumar',
        'Sandeep Kumar', 'Raj Kumar', 'Deepak Singh', 'Manish Kumar', 'Ashok Kumar',
        'Sunil Kumar', 'Ravi Kumar', 'Mukesh Kumar', 'Dinesh Kumar', 'Vijay Kumar',
        'Naresh Kumar', 'Harish Kumar', 'Mahesh Kumar', 'Ganesh Kumar', 'Dilip Kumar',
        'Sanjay Kumar', 'Ajay Kumar', 'Pradeep Kumar', 'Rahul Kumar', 'Sachin Kumar',
        'Nikhil Kumar', 'Arun Kumar', 'Tarun Kumar', 'Varun Kumar', 'Karan Kumar',
        'Rohan Kumar', 'Aman Kumar', 'Rahul Singh', 'Amit Singh', 'Rohit Singh',
        'Vikram Singh', 'Aditya Singh', 'Karan Singh', 'Arjun Singh', 'Yash Singh',
        'Harsh Singh', 'Vishal Kumar', 'Naveen Kumar', 'Pankaj Kumar', 'Rajesh Kumar'
      ],
      'Telugu': [
        'Venkatesh Reddy', 'Ramesh Naidu', 'Suresh Goud', 'Kumar Swamy', 'Rajesh Naidu',
        'Prakash Reddy', 'Anil Naidu', 'Vinod Goud', 'Sandeep Reddy', 'Deepak Naidu',
        'Manish Reddy', 'Ashok Naidu', 'Sunil Goud', 'Ravi Naidu', 'Mukesh Reddy',
        'Dinesh Naidu', 'Vijay Goud', 'Naresh Reddy', 'Harish Naidu', 'Mahesh Goud',
        'Ganesh Reddy', 'Dilip Naidu', 'Sanjay Goud', 'Ajay Reddy', 'Pradeep Naidu',
        'Rahul Goud', 'Sachin Reddy', 'Nikhil Naidu', 'Arun Goud', 'Tarun Reddy',
        'Varun Naidu', 'Karan Goud', 'Rohan Reddy', 'Aman Naidu', 'Vishal Goud',
        'Naveen Reddy', 'Pankaj Naidu', 'Rajesh Goud', 'Srinivas Reddy', 'Krishna Naidu',
        'Rama Naidu', 'Lakshmi Reddy', 'Sai Goud', 'Nagarjuna Reddy', 'Chandra Naidu',
        'Surya Goud', 'Venkat Reddy', 'Mohan Naidu', 'Raghu Goud', 'Siva Reddy'
      ],
      'Marathi': [
        'Rajesh Patil', 'Suresh Deshmukh', 'Kumar Jadhav', 'Anil Pawar', 'Vinod Kulkarni',
        'Prakash Patil', 'Sandeep Deshmukh', 'Deepak Jadhav', 'Manish Pawar', 'Ashok Kulkarni',
        'Sunil Patil', 'Ravi Deshmukh', 'Mukesh Jadhav', 'Dinesh Pawar', 'Vijay Kulkarni',
        'Naresh Patil', 'Harish Deshmukh', 'Mahesh Jadhav', 'Ganesh Pawar', 'Dilip Kulkarni',
        'Sanjay Patil', 'Ajay Deshmukh', 'Pradeep Jadhav', 'Rahul Pawar', 'Sachin Kulkarni',
        'Nikhil Patil', 'Arun Deshmukh', 'Tarun Jadhav', 'Varun Pawar', 'Karan Kulkarni',
        'Rohan Patil', 'Aman Deshmukh', 'Vishal Jadhav', 'Naveen Pawar', 'Pankaj Kulkarni',
        'Rajesh Gaikwad', 'Srinivas Patil', 'Krishna Deshmukh', 'Rama Jadhav', 'Lakshmi Pawar',
        'Sai Kulkarni', 'Nagarjuna Patil', 'Chandra Deshmukh', 'Surya Jadhav', 'Venkat Pawar',
        'Mohan Kulkarni', 'Raghu Patil', 'Siva Deshmukh', 'Shankar Jadhav', 'Ganesh Pawar'
      ],
      'Kannada': [
        'Ramesh Gowda', 'Suresh Reddy', 'Kumar Naidu', 'Anil Gowda', 'Vinod Reddy',
        'Prakash Naidu', 'Sandeep Gowda', 'Deepak Reddy', 'Manish Naidu', 'Ashok Gowda',
        'Sunil Reddy', 'Ravi Naidu', 'Mukesh Gowda', 'Dinesh Reddy', 'Vijay Naidu',
        'Naresh Gowda', 'Harish Reddy', 'Mahesh Naidu', 'Ganesh Gowda', 'Dilip Reddy',
        'Sanjay Naidu', 'Ajay Gowda', 'Pradeep Reddy', 'Rahul Naidu', 'Sachin Gowda',
        'Nikhil Reddy', 'Arun Naidu', 'Tarun Gowda', 'Varun Reddy', 'Karan Naidu',
        'Rohan Gowda', 'Aman Reddy', 'Vishal Naidu', 'Naveen Gowda', 'Pankaj Reddy',
        'Rajesh Naidu', 'Srinivas Gowda', 'Krishna Reddy', 'Rama Naidu', 'Lakshmi Gowda',
        'Sai Reddy', 'Nagarjuna Naidu', 'Chandra Gowda', 'Surya Reddy', 'Venkat Naidu',
        'Mohan Gowda', 'Raghu Reddy', 'Siva Naidu', 'Shankar Gowda', 'Ganesh Reddy'
      ],
      'Tamil': [
        'Ramesh Nair', 'Suresh Iyer', 'Kumar Reddy', 'Anil Nair', 'Vinod Iyer',
        'Prakash Reddy', 'Sandeep Nair', 'Deepak Iyer', 'Manish Reddy', 'Ashok Nair',
        'Sunil Iyer', 'Ravi Reddy', 'Mukesh Nair', 'Dinesh Iyer', 'Vijay Reddy',
        'Naresh Nair', 'Harish Iyer', 'Mahesh Reddy', 'Ganesh Nair', 'Dilip Iyer',
        'Sanjay Reddy', 'Ajay Nair', 'Pradeep Iyer', 'Rahul Reddy', 'Sachin Nair',
        'Nikhil Iyer', 'Arun Reddy', 'Tarun Nair', 'Varun Iyer', 'Karan Reddy',
        'Rohan Nair', 'Aman Iyer', 'Vishal Reddy', 'Naveen Nair', 'Pankaj Iyer',
        'Rajesh Reddy', 'Srinivas Nair', 'Krishna Iyer', 'Rama Reddy', 'Lakshmi Nair',
        'Sai Iyer', 'Nagarjuna Reddy', 'Chandra Nair', 'Surya Iyer', 'Venkat Reddy',
        'Mohan Nair', 'Raghu Iyer', 'Siva Reddy', 'Shankar Nair', 'Ganesh Iyer'
      ],
      'English': [
        'John Kumar', 'David Singh', 'Michael Reddy', 'Robert Naidu', 'William Goud',
        'James Patil', 'Richard Deshmukh', 'Joseph Jadhav', 'Thomas Pawar', 'Charles Kulkarni',
        'Christopher Gowda', 'Daniel Iyer', 'Matthew Nair', 'Anthony Reddy', 'Mark Naidu',
        'Donald Goud', 'Steven Patil', 'Paul Deshmukh', 'Andrew Jadhav', 'Joshua Pawar',
        'Kenneth Kulkarni', 'Kevin Gowda', 'Brian Iyer', 'George Nair', 'Timothy Reddy',
        'Ronald Naidu', 'Jason Goud', 'Edward Patil', 'Jeffrey Deshmukh', 'Ryan Jadhav',
        'Jacob Pawar', 'Gary Kulkarni', 'Nicholas Gowda', 'Eric Iyer', 'Jonathan Nair',
        'Stephen Reddy', 'Larry Naidu', 'Justin Goud', 'Scott Patil', 'Brandon Deshmukh',
        'Benjamin Jadhav', 'Samuel Pawar', 'Frank Kulkarni', 'Gregory Gowda', 'Raymond Iyer',
        'Alexander Nair', 'Patrick Reddy', 'Jack Naidu', 'Dennis Goud', 'Jerry Patil'
      ]
    };

    const generateMobileNumber = (index: number): string => {
      // Generate a unique 10-digit Indian mobile number (starts with 7, 8, or 9)
      const prefixes = [7, 8, 9];
      const prefix = prefixes[index % prefixes.length];
      const base = prefix * 1000000000;
      return String(base + (index % 100000000)).padStart(10, '0');
    };

    const generateFarmerName = (index: number, language: string): string => {
      const names = INDIAN_NAMES[language] || INDIAN_NAMES['Hindi'];
      return names[index % names.length];
    };

    const generateIndianLocation = (index: number, language: string): { state: string; district: string; village: string; territory: string; zoneName: string; buName: string } => {
      const languageStateMap: Record<string, string[]> = {
        'Hindi': ['Uttar Pradesh', 'Bihar', 'Madhya Pradesh', 'Rajasthan', 'Haryana'],
        'Telugu': ['Andhra Pradesh', 'Telangana'],
        'Marathi': ['Maharashtra'],
        'Kannada': ['Karnataka'],
        'Tamil': ['Tamil Nadu'],
        'English': ['Karnataka', 'Kerala', 'Tamil Nadu']
      };
      
      const possibleStates = languageStateMap[language] || ['Uttar Pradesh'];
      const state = possibleStates[index % possibleStates.length];
      const districts = INDIAN_DISTRICTS[state] || ['District 1'];
      const district = districts[index % districts.length];
      const village = INDIAN_VILLAGES[index % INDIAN_VILLAGES.length];
      const territory = `${state} Zone`;
      const zoneName = ['North Zone', 'South Zone', 'East Zone', 'West Zone'][index % 4];
      const buName = ['BU - Seeds', 'BU - Crop Protection', 'BU - Fertilizers'][index % 3];
      
      return { state, district, village, territory, zoneName, buName };
    };

    // Find agent user
    const agent = await User.findOne({ email: 'shubhashish@intelliagri.in' });
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agent user not found. Please seed agent first.' },
      });
    }

    const count = parseInt(req.body.count || '50');
    const existingFarmerCount = await Farmer.countDocuments();
    
    // Create farmers
    const farmerIds: any[] = [];
    for (let i = 0; i < count; i++) {
      const mobileNumber = generateMobileNumber(existingFarmerCount + i);
      let farmer = await Farmer.findOne({ mobileNumber });
      
      if (!farmer) {
        const language = LANGUAGES[i % LANGUAGES.length];
        const { state: farmerState, district, village, territory } = generateIndianLocation(existingFarmerCount + i, language);
        const farmerName = generateFarmerName(existingFarmerCount + i, language);
        
        farmer = new Farmer({
          name: farmerName,
          mobileNumber,
          location: `${village}, ${district}, ${farmerState}`,
          preferredLanguage: language,
          territory: territory,
        });
        await farmer.save();
      }
      farmerIds.push(farmer._id);
    }

    // Create activities
    const activityIds: any[] = [];
    const existingActivityCount = await Activity.countDocuments();
    const farmersPerActivity = 12; // Increased to ensure good sampling

    for (let i = 0; i < count; i++) {
      const activityId = `TEST-ACT-${Date.now()}-${i}`;
      let activity = await Activity.findOne({ activityId });
      
      if (!activity) {
        const shuffled = [...farmerIds].sort(() => 0.5 - Math.random());
        const selectedFarmers = shuffled.slice(0, Math.min(farmersPerActivity, farmerIds.length));
        
        // Get location, territory, and officer details from first farmer
        const firstFarmer = await Farmer.findById(selectedFarmers[0]);
        const activityLocation = firstFarmer ? firstFarmer.location.split(',')[0] : INDIAN_VILLAGES[i % INDIAN_VILLAGES.length];
        const activityTerritory = firstFarmer ? firstFarmer.territory : TERRITORIES[i % TERRITORIES.length];
        const activityState = activityTerritory ? activityTerritory.replace(/\s+Zone$/i, '').trim() : '';
        const zoneName = ['North Zone', 'South Zone', 'East Zone', 'West Zone'][i % 4];
        const buName = ['BU - Seeds', 'BU - Crop Protection', 'BU - Fertilizers'][i % 3];
        const officerName = INDIAN_OFFICER_NAMES[i % INDIAN_OFFICER_NAMES.length];
        const officerId = `OFF-${String.fromCharCode(65 + (i % 26))}${(i % 1000).toString().padStart(3, '0')}`;
        
        activity = new Activity({
          activityId,
          type: ACTIVITY_TYPES[i % ACTIVITY_TYPES.length],
          date: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)),
          officerId: officerId,
          officerName: officerName,
          location: activityLocation,
          territory: activityTerritory,
          territoryName: activityTerritory,
          zoneName,
          buName,
          state: activityState,
          farmerIds: selectedFarmers,
          crops: CROPS.slice(0, Math.min((i % 4) + 2, CROPS.length)), // 2-5 crops per activity
          products: PRODUCTS.slice(0, Math.min((i % 3) + 1, PRODUCTS.length)), // 1-3 products per activity
        });
        await activity.save();
      }
      activityIds.push(activity._id);
    }

    // Process sampling to create tasks
    let tasksCreated = 0;
    for (const activityId of activityIds) {
      try {
        const result = await sampleAndCreateTasks(activityId.toString());
        tasksCreated += result.tasksCreated;
      } catch (error) {
        logger.error(`Error processing activity ${activityId}:`, error);
      }
    }

    // Update task dates to today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await CallTask.updateMany(
      {
        assignedAgentId: agent._id,
        status: 'sampled_in_queue',
        scheduledDate: { $ne: today },
      },
      {
        $set: { scheduledDate: today },
      }
    );

    // Get final counts
    const agentTaskCount = await CallTask.countDocuments({
      assignedAgentId: agent._id,
      status: { $in: ['sampled_in_queue', 'in_progress'] },
    });

    const totalTasks = await CallTask.countDocuments();

    res.json({
      success: true,
      message: 'Test data created successfully',
      data: {
        farmersCreated: farmerIds.length,
        activitiesCreated: activityIds.length,
        tasksCreated,
        agentTasks: agentTaskCount,
        totalTasks,
      },
    });
  } catch (error) {
    logger.error('Error creating test data:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to create test data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// API routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import taskRoutes from './routes/tasks.js';
import ffaRoutes from './routes/ffa.js';
import samplingRoutes from './routes/sampling.js';
import masterDataRoutes from './routes/masterData.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/ffa', ffaRoutes);
app.use('/api/sampling', samplingRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/kpi', dashboardRoutes);
app.use('/api/reports', reportRoutes);

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Setup cron jobs ONLY when explicitly enabled.
    // This prevents unexpected background syncs (e.g., scheduled FFA sync) in production environments.
    if (process.env.ENABLE_CRON === 'true') {
      const { setupCronJobs } = await import('./config/cron.js');
      setupCronJobs();
    }

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;

