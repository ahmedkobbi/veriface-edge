export async function POST(req: Request) {
  // Redirect to status endpoint for processing
  return Response.json({ success: false, error: 'Use /api/admin/replication/status with POST method' }, { status: 400 })
}
