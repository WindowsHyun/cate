import React, { useState, useRef, useEffect } from 'react'
import { CaretRight, CaretDown } from '@phosphor-icons/react'
import type { WorkspaceGroup } from '../../shared/types'
import { useAppStore, GROUP_COLORS, GROUP_COLOR_MAP } from '../stores/appStore'
import type { NativeContextMenuItem } from '../../shared/electron-api.d'

interface WorkspaceGroupRowProps {
  group: WorkspaceGroup
  workspaceCount: number
  insertIndex?: number | null
  groupIndex: number
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

export const WorkspaceGroupRow: React.FC<WorkspaceGroupRowProps> = ({
  group,
  workspaceCount,
  insertIndex,
  groupIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const toggleGroupCollapsed = useAppStore((s) => s.toggleGroupCollapsed)
  const updateWorkspaceGroup = useAppStore((s) => s.updateWorkspaceGroup)
  const removeWorkspaceGroup = useAppStore((s) => s.removeWorkspaceGroup)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commitEdit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== group.name) {
      updateWorkspaceGroup(group.id, { name: trimmed })
    } else {
      setEditName(group.name)
    }
    setEditing(false)
  }

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.electronAPI) return

    const colorItems: NativeContextMenuItem[] = GROUP_COLORS.map((c) => ({
      id: `color-${c.value}`,
      label: c.label,
    }))

    const items: NativeContextMenuItem[] = [
      { id: 'rename', label: 'Rename Group' },
      { id: 'color-menu', label: 'Change Color', submenu: colorItems },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Group' },
    ]

    const id = await window.electronAPI.showContextMenu(items)
    if (!id) return
    if (id === 'rename') {
      setEditName(group.name)
      setEditing(true)
    } else if (id.startsWith('color-')) {
      updateWorkspaceGroup(group.id, { color: id.slice(6) })
    } else if (id === 'delete') {
      removeWorkspaceGroup(group.id)
    }
  }

  const colorClass = GROUP_COLOR_MAP[group.color] ?? 'bg-zinc-500'

  return (
    <div
      className="relative"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {insertIndex === groupIndex && (
        <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-400/60 z-10 pointer-events-none" />
      )}
      {/* Colored left bar */}
      <div className={`absolute left-0 top-0 h-full w-1 ${colorClass}`} />
      <div
        className="flex items-center gap-1.5 pl-3 pr-2 py-1 cursor-pointer select-none hover:bg-white/5 group/group-row"
        onClick={() => toggleGroupCollapsed(group.id)}
        onContextMenu={handleContextMenu}
      >

        {/* Name / edit field */}
        {editing ? (
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-[var(--sidebar-fg)] outline-none border-b border-[var(--accent)] py-0"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') { setEditName(group.name); setEditing(false) }
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs font-semibold text-[var(--sidebar-fg)] truncate">
            {group.name}
          </span>
        )}

        {/* Count badge */}
        {workspaceCount > 0 && (
          <span className="text-[10px] text-[var(--sidebar-fg-muted)] tabular-nums">
            {workspaceCount}
          </span>
        )}

        {/* Collapse chevron */}
        <span className="text-[var(--sidebar-fg-muted)] ml-auto flex-shrink-0">
          {group.collapsed
            ? <CaretRight size={11} weight="bold" />
            : <CaretDown size={11} weight="bold" />}
        </span>
      </div>
    </div>
  )
}
