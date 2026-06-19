import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DELETE /api/sessions/[id]
// Permanently deletes a session and all its messages/events.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await db.session.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    // Cascade delete handles ChatMessage and SessionEvent
    await db.session.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (err: any) {
    console.error('DELETE /api/sessions/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
