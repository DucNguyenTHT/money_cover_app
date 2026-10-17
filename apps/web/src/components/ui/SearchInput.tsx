import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Search box with the same look as IngredientPicker: icon inside, blue border + ring while focused. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { className?: string }
>(function SearchInput({ className, onFocus, onBlur, ...rest }, ref) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-ctl border border-field bg-white px-2.5',
        focus && 'border-primary ring-4 ring-primary/15',
        className,
      )}
    >
      <Search size={15} className="shrink-0 text-faint" />
      <input
        ref={ref}
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
        className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        {...rest}
      />
    </div>
  );
});
