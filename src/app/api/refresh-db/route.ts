import { NextResponse } from 'next/server'
import { resetShadowDb } from '@/utils/db-manager'

export async function POST() {
  try {
    resetShadowDb()
    return NextResponse.json({ success: true, message: 'Database refreshed' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to refresh database' }, { status: 500 })
  }
}



