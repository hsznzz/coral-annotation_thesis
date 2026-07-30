function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  const classes = [
    'inline-block animate-spin rounded-full border-2 border-emerald-400 border-t-transparent',
    sizes[size] || sizes.md,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={classes} aria-label="Loading" />;
}

export default Spinner;
