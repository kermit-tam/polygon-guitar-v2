import { clearTabCache } from '@/lib/tabs'

export default async function handler(req, res) {
  const { id, slug } = req.query
  if (!id) return res.status(400).json({ error: 'Missing id' })

  try {
    clearTabCache(id)
    await res.revalidate(`/tabs/${id}`)
    // Also revalidate the slug URL if provided and different from id
    if (slug && slug !== id) {
      try { await res.revalidate(`/tabs/${slug}`) } catch (_) {}
    }
    return res.json({ revalidated: true })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to revalidate' })
  }
}
