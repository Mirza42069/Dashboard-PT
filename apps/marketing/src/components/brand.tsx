export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="brand" data-inverse={inverse || undefined} lang="ja">
      普請
    </span>
  );
}
