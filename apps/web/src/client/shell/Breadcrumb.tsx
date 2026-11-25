export function Breadcrumb({ crumbs }: { crumbs: string[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {crumbs.map((c, i) => (
          <li key={c} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c}</li>
        ))}
      </ol>
    </nav>
  )
}
