import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DELETE /api/unattended/[id]
// Removes an unattended machine registration.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const machine = await db.unattendedMachine.findUnique({ where: { id } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }
    await db.unattendedMachine.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (err: any) {
    console.error('DELETE /api/unattended/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
