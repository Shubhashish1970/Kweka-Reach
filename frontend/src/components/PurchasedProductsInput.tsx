import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import UnitDropdown from './UnitDropdown';

interface PurchasedProduct {
  product: string;
  quantity: string;
  unit: string; // 'kg' | 'gms' | 'lt'
}

interface PurchasedProductsInputProps {
  products: string[];
  activityProducts?: string[];
  suggestedProducts?: string[];
  selectedProducts: PurchasedProduct[];
  onUpdate: (products: PurchasedProduct[]) => void;
}

const mergeUniqueProducts = (...lists: (string[] | undefined)[]): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const product of list ?? []) {
      const trimmed = product?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }

  return merged;
};

const PurchasedProductsInput: React.FC<PurchasedProductsInputProps> = ({
  products,
  activityProducts = [],
  suggestedProducts = [],
  selectedProducts,
  onUpdate,
}) => {
  const [showAddInput, setShowAddInput] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [customProduct, setCustomProduct] = useState('');

  const searchableProducts = useMemo(
    () => mergeUniqueProducts(activityProducts, suggestedProducts, products),
    [activityProducts, suggestedProducts, products]
  );

  const isProductSelected = (productName: string) =>
    selectedProducts.some((sp) => sp.product.toLowerCase() === productName.toLowerCase());

  const filteredProducts = searchableProducts.filter(
    (product) =>
      product.toLowerCase().includes(searchTerm.toLowerCase()) && !isProductSelected(product)
  );

  const availableActivityProducts = activityProducts.filter((product) => !isProductSelected(product));

  const handleAddProduct = (productName: string) => {
    if (!isProductSelected(productName)) {
      onUpdate([...selectedProducts, { product: productName, quantity: '', unit: 'kg' }]);
    }
    setSearchTerm('');
    setCustomProduct('');
    setShowAddInput(false);
  };

  const handleRemoveProduct = (index: number) => {
    onUpdate(selectedProducts.filter((_, i) => i !== index));
  };

  const handleQuantityChange = (index: number, quantity: string) => {
    const updated = [...selectedProducts];
    updated[index].quantity = quantity;
    onUpdate(updated);
  };

  const handleUnitChange = (index: number, unit: string) => {
    const updated = [...selectedProducts];
    updated[index].unit = unit;
    onUpdate(updated);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && customProduct.trim()) {
      e.preventDefault();
      handleAddProduct(customProduct.trim());
    } else if (e.key === 'Escape') {
      setShowAddInput(false);
      setSearchTerm('');
      setCustomProduct('');
    }
  };

  const hasSearchText = Boolean(searchTerm || customProduct);

  return (
    <div className="space-y-3 overflow-visible">
      {availableActivityProducts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableActivityProducts.map((product) => (
            <button
              key={product}
              type="button"
              onClick={() => handleAddProduct(product)}
              className="px-4 py-2 rounded-full text-xs font-medium border transition-all active:scale-95 min-h-[32px] bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
            >
              {product}
            </button>
          ))}
        </div>
      )}

      {/* Selected Products List */}
      {selectedProducts.length > 0 && (
        <div className="space-y-2">
          {selectedProducts.map((item, index) => (
            <div
              key={`${item.product}-${index}`}
              className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200"
            >
              <div className="flex-1 flex items-center gap-2">
                <div className="text-xs font-medium text-slate-700 min-w-[120px]">{item.product}</div>
                <input
                  type="text"
                  value={item.quantity}
                  onChange={(e) => handleQuantityChange(index, e.target.value)}
                  placeholder="Qty"
                  className="w-20 min-h-12 px-4 py-3 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
                <UnitDropdown
                  value={item.unit || 'kg'}
                  onChange={(unit) => handleUnitChange(index, unit)}
                />
              </div>
              <button
                onClick={() => handleRemoveProduct(index)}
                className="p-1.5 text-slate-400 hover:text-red-600 transition-all rounded-lg hover:bg-slate-100 shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Product Input */}
      {!showAddInput ? (
        <button
          onClick={() => setShowAddInput(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-full hover:bg-slate-50 transition-all"
        >
          <Plus size={14} />
          Add Product
        </button>
      ) : (
        <div className="relative inline-block overflow-visible">
          <div className="flex items-center gap-1.5">
            <div className="relative overflow-visible">
              <input
                type="text"
                value={searchTerm || customProduct}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCustomProduct(e.target.value);
                }}
                onKeyDown={handleKeyPress}
                onBlur={(e) => {
                  if (!e.relatedTarget || !e.relatedTarget.closest('.dropdown-suggestions')) {
                    setTimeout(() => {
                      if (!customProduct.trim()) {
                        setShowAddInput(false);
                      }
                    }, 200);
                  }
                }}
                placeholder="Search or type product name..."
                className="min-h-12 px-4 py-3 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 min-w-[180px] max-w-[250px]"
                autoFocus
              />
              {hasSearchText && filteredProducts.length > 0 && (
                <div className="dropdown-suggestions absolute z-50 bottom-full mb-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto min-w-[240px] w-max max-w-[320px]">
                  {filteredProducts.map((product) => (
                    <button
                      key={product}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddProduct(product)}
                      className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                    >
                      {product}
                    </button>
                  ))}
                </div>
              )}
              {hasSearchText && filteredProducts.length === 0 && (
                <div className="dropdown-suggestions absolute z-50 bottom-full mb-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[240px]">
                  <div className="px-4 py-3 text-sm text-slate-500 italic font-normal">
                    Press Enter to add "{customProduct}"
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (customProduct.trim()) {
                  handleAddProduct(customProduct.trim());
                } else {
                  setShowAddInput(false);
                }
              }}
              disabled={!customProduct.trim()}
              className="px-3 py-1.5 rounded-full text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-green-700 text-white"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddInput(false);
                setSearchTerm('');
                setCustomProduct('');
              }}
              className="p-1 text-slate-400 hover:text-slate-600 transition-all rounded-full hover:bg-slate-100"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchasedProductsInput;
