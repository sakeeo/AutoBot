import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="d-flex flex-column align-items-center justify-content-center min-vh-100 text-center p-3">
      <h1 className="h4">Halaman tidak ditemukan</h1>
      <Link href="/" className="btn btn-primary mt-3">Ke beranda</Link>
    </main>
  )
}
