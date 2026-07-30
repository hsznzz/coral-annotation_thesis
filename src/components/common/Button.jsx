function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  ...props
}) {
  const base =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900';

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };

  const variants = {
    primary:
      'bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500 disabled:bg-emerald-500/60 disabled:cursor-not-allowed',
    ghost:
      'bg-transparent text-slate-200 hover:bg-slate-800/80 focus:ring-slate-600 disabled:text-slate-500 disabled:hover:bg-transparent',
    danger:
      'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500 disabled:bg-red-500/60 disabled:cursor-not-allowed',
  };

  const classes = [
    base,
    sizes[size] || sizes.md,
    variants[variant] || variants.primary,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled} {...props}>
      {children}
    </button>
  );
}

export default Button;
