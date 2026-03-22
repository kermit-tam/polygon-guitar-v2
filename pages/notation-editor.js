import Layout from '@/components/Layout'
import NotationEditorWorkspace from '@/components/NotationEditor/NotationEditorWorkspace'

/**
 * Standalone notation editor route (bookmarkable). Same core as modal in tab edit.
 */
export default function NotationEditorPage() {
  return (
    <Layout>
      <div className="min-h-screen">
        <NotationEditorWorkspace hydration="session" embedMode={false} />
      </div>
    </Layout>
  )
}
