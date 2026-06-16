import { useSettingsStore } from '../stores/settingsStore'
import { SettingRow, Toggle, TextInput, Select } from './SettingsComponents'
import { useTranslation } from '../hooks/useTranslation'

export function GeneralSettings() {
  const store = useSettingsStore()
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-1">
      <SettingRow label={t('general.language')} description={t('general.language.desc')}>
        <Select
          value={store.language ?? 'en'}
          onChange={(v) => store.setSetting('language', v as 'en' | 'ko')}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ko', label: '한국어' },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('general.shell')} description={t('general.shell.desc')}>
        <TextInput value={store.defaultShellPath} onChange={(v) => store.setSetting('defaultShellPath', v)} placeholder="Auto-detect" />
      </SettingRow>
      <SettingRow label={t('general.warnQuit')} description={t('general.warnQuit.desc')}>
        <Toggle checked={store.warnBeforeQuit} onChange={(v) => store.setSetting('warnBeforeQuit', v)} />
      </SettingRow>
      <SettingRow
        label="Privacy"
        description="Cate collects anonymous usage data and crash reports to improve the app. No file paths, project names, or personal data."
      >
        <button
          type="button"
          onClick={() => window.electronAPI?.openExternalUrl('https://cate.cero-ai.com/privacy')}
          className="text-blue-400 hover:text-blue-300 text-[12px] font-medium whitespace-nowrap"
        >
          Privacy Policy
        </button>
      </SettingRow>
    </div>
  )
}
