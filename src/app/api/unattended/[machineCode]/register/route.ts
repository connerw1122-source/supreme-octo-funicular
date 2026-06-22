import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/unattended/[machineCode]/register
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ machineCode: string }> }
) {
  try {
    const { machineCode } = await params
    const normalized = machineCode.toUpperCase().trim()
    const body = await req.json().catch(() => ({}))
    const hostname = (body?.hostname ?? '').toString().trim() || null
    const os = (body?.os ?? '').toString().trim() || null

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode: normalized } })
    if (!machine) {
      return NextResponse.json({ error: 'Invalid setup code' }, { status: 404 })
    }

    const updated = await db.unattendedMachine.update({
      where: { id: machine.id },
      data: { hostname, os, status: 'online', lastSeenAt: new Date() },
    })

    return NextResponse.json({
      id: updated.id,
      machineCode: updated.machineCode,
      customerName: updated.customerName,
      status: updated.status,
    })
  } catch (err: any) {
    console.error('POST /api/unattended/[machineCode]/register error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
