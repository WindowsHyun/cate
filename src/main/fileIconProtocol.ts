import { protocol, app } from 'electron'
import fs from 'fs'
import path from 'path'

export function registerFileIconProtocol(): void {
  const iconsDir = path.join(app.getAppPath(), 'node_modules', 'material-icon-theme', 'icons')

  protocol.handle('maticon', async (request) => {
    const iconName = decodeURIComponent(new URL(request.url).hostname)
    const filePath = path.join(iconsDir, iconName)
    try {
      const data = await fs.promises.readFile(filePath, 'utf8')
      return new Response(data, { headers: { 'Content-Type': 'image/svg+xml' } })
    } catch {
      return new Response('', { status: 404 })
    }
  })
}
