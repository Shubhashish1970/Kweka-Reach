import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

interface SearchableMultiSelectProps {
  label: string;
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
  /** Kept for API compatibility; Select Contact uses a neutral Filter By theme. */
  color?: 'green' | 'indigo';
  placeholder?: string;
  activityItems?: string[]; // Items from activity to highlight
}

const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  label,
  items,
  selected,
  onToggle,
  placeholder = 'Search and select...',
  activityItems = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredItems = items.filter((item) =>
    item.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const isActivityItem = (item: string) => activityItems.includes(item);
  const isSelected = (item: string) => selected.includes(item);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-slate-500">{label}</label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200"
            >
              <span>{item}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(item);
                }}
                className="text-slate-400 hover:text-slate-700 rounded p-0.5 transition-colors"
                aria-label={`Remove ${item}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full h-9 pl-3 pr-8 py-1.5 bg-white border rounded-lg text-xs font-medium text-left flex items-center gap-2 transition-colors appearance-none ${
            isOpen
              ? 'border-lime-400 ring-2 ring-lime-400 focus:outline-none'
              : 'border-slate-200 hover:border-slate-300'
          } ${selected.length === 0 ? 'text-slate-400' : 'text-slate-900'}`}
        >
          <Search size={14} className="text-slate-400 shrink-0" />
          <span className="truncate flex-1">
            {selected.length > 0 ? `${selected.length} selected` : placeholder}
          </span>
          <ChevronDown
            size={12}
            className={`absolute right-2.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
            <div className="p-1.5 border-b border-slate-200">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full h-9 pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
            </div>

            <div className="overflow-y-auto max-h-48">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-2.5 text-center text-xs text-slate-500">No items found</div>
              ) : (
                filteredItems.map((item) => {
                  const checked = isSelected(item);
                  const isActivity = isActivityItem(item);

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onToggle(item)}
                      className="w-full px-3 py-2 text-left text-xs font-medium text-slate-900 border-b border-slate-100 last:border-b-0 flex items-center gap-2.5 hover:bg-slate-50 transition-colors"
                    >
                      <span
                        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${
                          checked
                            ? 'bg-slate-800 border-slate-800 text-white'
                            : 'bg-white border-slate-300'
                        }`}
                        aria-hidden
                      >
                        {checked && (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2.5 6.5L5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{item}</span>
                      {isActivity && !checked && (
                        <span className="text-[10px] text-blue-600 font-bold shrink-0">(from activity)</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {activityItems.length > 0 && (
              <div className="p-2 border-t border-slate-200 bg-slate-50">
                <p className="text-[10px] text-slate-600 font-medium">
                  Items marked &quot;(from activity)&quot; are from the Field Officer&apos;s report
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchableMultiSelect;
