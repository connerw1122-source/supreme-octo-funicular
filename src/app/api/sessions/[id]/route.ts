import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/sessions/[id] - lookup a session by code OR id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const normalized = id.toUpperCase().trim()
    if (!normalized) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }
    // Try by ID first, then by code
    let session = await db.session.findUnique({
      where: { id },
      include: { technician: true },
    })
    if (!session) {
      session = await db.session.findUnique({
        where: { code: normalized },
        include: { technician: true },
      })
    }
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status === 'ended') {
      return NextResponse.json({ error: 'This session has already ended' }, { status: 410 })
    }
    return NextResponse.json({
      id: session.id,
      code: session.code,
      title: session.title,
      customerName: session.customerName,
      status: session.status,
      createdAt: session.createdAt,
      technician: session.technician
        ? { id: session.technician.id, name: session.technician.name }
        : null,
    })
  } catch (err: any) {
    console.error('GET /api/sessions/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
