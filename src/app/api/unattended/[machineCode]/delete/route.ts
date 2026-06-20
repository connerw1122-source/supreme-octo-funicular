import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ machineCode: string }> }
) {
  try {
    const { machineCode } = await params
    const machine = await db.unattendedMachine.findUnique({ where: { id: machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }
    await db.unattendedMachine.delete({ where: { id: machineCode } })
    return NextResponse.json({ ok: true, id: machineCode })
  } catch (err: any) {
    console.error('DELETE /api/unattended/[machineCode] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
