export function ProductMark({ withName = true }: { withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="am-brand-mark" aria-hidden="true">
        <span className="am-brand-dot" />
      </span>
      {withName ? (
        <span>
          <span className="block text-sm font-semibold tracking-[-0.01em] text-white">
            Agency Monitor
          </span>
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-[#6f7b91]">
            Site observatory
          </span>
        </span>
      ) : null}
    </span>
  );
}
