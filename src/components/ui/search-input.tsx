"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange"
> {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  /** 右端插槽（例如「取消」按钮） */
  trailing?: React.ReactNode;
  containerClassName?: string;
}

/**
 * 全局统一搜索框。
 * 移动端：48px 高、圆角、左侧放大镜，符合手指操作。
 */
export function SearchInput({
  value,
  onValueChange,
  onClear,
  placeholder = "搜索…",
  trailing,
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onValueChange("");
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div className={cn("flex items-center gap-2", containerClassName)}>
      <div className="relative flex-1">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "rounded-control border-input bg-card text-foreground h-12 w-full border pr-10 pl-10 text-[16px]",
            "placeholder:text-subtle-foreground",
            "focus-visible:border-brand focus-visible:ring-brand/25 transition-shadow outline-none focus-visible:ring-2",
            "[&::-webkit-search-cancel-button]:appearance-none",
            className,
          )}
          {...props}
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="清空搜索"
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-full transition-colors"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}
