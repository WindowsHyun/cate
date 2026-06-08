import iconData from 'material-icon-theme/dist/material-icons.json'

const {
  fileExtensions,
  fileNames,
  folderNames,
  folderNamesExpanded,
} = iconData as {
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
}

export function getFileIconUrl(filename: string, isDir: boolean, isExpanded: boolean): string {
  if (isDir) {
    const lower = filename.toLowerCase()
    const map = isExpanded ? (folderNamesExpanded ?? {}) : (folderNames ?? {})
    const iconName = map[lower] ?? (isExpanded ? 'folder-open' : 'folder')
    return `maticon://${iconName}.svg`
  }

  const lower = filename.toLowerCase()

  // Exact filename takes priority (e.g. package.json, tsconfig.json, .eslintrc)
  if (fileNames[lower]) return `maticon://${fileNames[lower]}.svg`

  // Extension lookup (try compound first: d.ts, spec.ts, then last segment)
  const firstDot = lower.indexOf('.')
  if (firstDot !== -1) {
    const compound = lower.slice(firstDot + 1)   // e.g. "d.ts" from "foo.d.ts"
    if (fileExtensions[compound]) return `maticon://${fileExtensions[compound]}.svg`
    const ext = lower.slice(lower.lastIndexOf('.') + 1)
    if (fileExtensions[ext]) return `maticon://${fileExtensions[ext]}.svg`
  }

  return 'maticon://file.svg'
}
