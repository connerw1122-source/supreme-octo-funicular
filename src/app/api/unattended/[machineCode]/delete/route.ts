import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DELETE /api/unattended/[machineCode]
// Removes an unattended machine registration by its machine code.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ machineCode: string }> }
) {
  try {
    const { machineCode } = await params
    const normalized = machineCode.toUpperCase().trim()
    const machine = await db.unattendedMachine.findUnique({
      where: { machineCode: normalized },
    })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }
    await db.unattendedMachine.delete({ where: { id: machine.id } })
    return NextResponse.json({ ok: true, machineCode: normalized })
  } catch (err: any) {
    console.error('DELETE /api/unattended/[machineCode] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
