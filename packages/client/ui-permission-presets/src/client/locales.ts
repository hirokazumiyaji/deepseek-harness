/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Locale namespace shared by both current-session permission pickers. */
export const PERMISSION_ACCESS_NS = 'permission.access'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
  'auto.label': '自动',
  'auto.confirm.title': '确认启用自动模式？',
  'auto.confirm.description': '自动模式不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型审查是否允许；审查拒绝的调用由你批准或拒绝。审查可能误放行或误拒绝操作，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用自动模式',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'auto.label': 'Auto',
  'auto.confirm.title': 'Enable Auto mode?',
  'auto.confirm.description': 'Auto mode runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it; you approve or reject each call it denies. A review can wrongly allow or deny an action and uses additional tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto mode',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'mode': '访问模式，当前：{name}',
  'close': '关闭',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
  'auto.label': '自动',
  'auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前，由同一模型审查是否允许。',
  'auto.confirm.title': '确认启用自动模式？',
  'auto.confirm.description': '自动模式不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型审查是否允许；审查拒绝的调用由你批准或拒绝。审查可能误放行或误拒绝操作，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用自动模式',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'mode': 'Access mode, current: {name}',
  'close': 'Close',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'auto.label': 'Auto',
  'auto.description': 'Run without a sandbox; before every native tool call and PTC inner call the same model reviews whether to allow it.',
  'auto.confirm.title': 'Enable Auto mode?',
  'auto.confirm.description': 'Auto mode runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it; you approve or reject each call it denies. A review can wrongly allow or deny an action and uses additional tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto mode',
} satisfies Record<PermissionAccessKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'title': '権限',
  'description': '新しいセッションのデフォルトの権限モードを選択',
  'loading': '読み込み中',
  'unavailable': '利用不可',
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
  'confirm.title': 'フルアクセスを有効にしますか？',
  'confirm.description': 'フルアクセスでは、新しいセッションで確認ステップが減り、機密操作・ファイル変更・外部コマンドなど多くの操作を直接実行できるようになります。以降のタスクを信頼できる場合にのみ使用してください。',
  'confirm.acknowledge': 'リスクを理解し、続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'フルアクセスを有効にする',
  'auto.label': '自動',
  'auto.confirm.title': '自動モードを有効にしますか？',
  'auto.confirm.description': '自動モードはサンドボックスなしで実行されます。ネイティブツール呼び出しと PTC 内部呼び出しのたびに、現在のエージェントと同じモデルが許可可否をレビューし、拒否された呼び出しはあなたが承認または却下します。レビューは操作を誤って許可・拒否する可能性があり、追加のトークンを消費します。',
  'auto.confirm.acknowledge': 'これらのリスクを理解し、続行します',
  'auto.confirm.enable': '自動モードを有効にする',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'title': 'Permiso',
  'description': 'Elija el modo de permiso predeterminado para nuevas sesiones',
  'loading': 'Cargando',
  'unavailable': 'No disponible',
  'preset.readOnly': 'Sólo lectura',
  'preset.workspaceWrite': 'Escritura en el espacio de trabajo',
  'preset.fullAccess': 'Acceso completo',
  'confirm.title': '¿Habilitar acceso completo?',
  'confirm.description': 'El acceso completo permite que las nuevas sesiones reduzcan los pasos de confirmación y realicen más acciones directamente, incluidas operaciones confidenciales, cambios de archivos o comandos externos. Úselo sólo cuando confíe en las tareas posteriores.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar.',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Habilitar acceso completo',
  'auto.label': 'Automático',
  'auto.confirm.title': '¿Habilitar el modo automático?',
  'auto.confirm.description': 'El modo automático se ejecuta sin zona de pruebas. Antes de cada llamada a herramienta nativa y llamada interna PTC, el mismo modelo que el agente actual revisa si se permite; usted aprueba o rechaza cada llamada que rechaza. La revisión puede permitir o denegar acciones erróneamente y utiliza tokens adicionales.',
  'auto.confirm.acknowledge': 'Entiendo estos riesgos y quiero continuar',
  'auto.confirm.enable': 'Habilitar el modo automático',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'title': 'Autorisation',
  'description': "Choisissez le mode d'autorisation par défaut pour les nouvelles sessions",
  'loading': 'Chargement',
  'unavailable': 'Indisponible',
  'preset.readOnly': 'Lecture seule',
  'preset.workspaceWrite': "Écriture dans l'espace de travail",
  'preset.fullAccess': 'Accès complet',
  'confirm.title': "Activer l'accès complet ?",
  'confirm.description': "L'accès complet permet aux nouvelles sessions de réduire les étapes de confirmation et d'effectuer directement davantage d'actions, notamment des opérations sensibles, des modifications de fichiers ou des commandes externes. Utilisez-le uniquement lorsque vous faites confiance aux tâches suivantes.",
  'confirm.acknowledge': 'Je comprends les risques et je veux continuer',
  'confirm.cancel': 'Annuler',
  'confirm.enable': "Activer l'accès complet",
  'auto.label': 'Auto',
  'auto.confirm.title': 'Activer le mode auto ?',
  'auto.confirm.description': "Le mode auto fonctionne sans bac à sable. Avant chaque appel d'outil natif et appel interne PTC, le même modèle que l'agent actuel vérifie s'il doit l'autoriser ; vous approuvez ou rejetez chaque appel qu'il refuse. L'examen peut autoriser ou refuser une action à tort et utilise des jetons supplémentaires.",
  'auto.confirm.acknowledge': 'Je comprends ces risques et je veux continuer',
  'auto.confirm.enable': 'Activer le mode auto',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'title': 'Erlaubnis',
  'description': 'Wählen Sie den Standardberechtigungsmodus für neue Sitzungen',
  'loading': 'Laden',
  'unavailable': 'Nicht verfügbar',
  'preset.readOnly': 'Nur lesen',
  'preset.workspaceWrite': 'Arbeitsbereich schreiben',
  'preset.fullAccess': 'Voller Zugriff',
  'confirm.title': 'Vollzugriff aktivieren?',
  'confirm.description': 'Durch den vollständigen Zugriff können neue Sitzungen die Bestätigungsschritte reduzieren und mehr Aktionen direkt ausführen, einschließlich vertraulicher Vorgänge, Dateiänderungen oder externer Befehle. Verwenden Sie es nur, wenn Sie nachfolgenden Aufgaben vertrauen.',
  'confirm.acknowledge': 'Ich verstehe die Risiken und möchte weitermachen',
  'confirm.cancel': 'Abbrechen',
  'confirm.enable': 'Aktivieren Sie Vollzugriff',
  'auto.label': 'Auto',
  'auto.confirm.title': 'Auto-Modus aktivieren?',
  'auto.confirm.description': 'Der Auto-Modus läuft ohne Sandbox. Vor jedem nativen Tool-Aufruf und PTC-Innenaufruf prüft dasselbe Modell wie der aktuelle Agent, ob der Aufruf zulässig ist; Sie genehmigen oder lehnen jeden abgelehnten Aufruf ab. Eine Prüfung kann Aktionen fälschlicherweise zulassen oder verweigern und verbraucht zusätzliche Token.',
  'auto.confirm.acknowledge': 'Ich verstehe diese Risiken und möchte weitermachen',
  'auto.confirm.enable': 'Auto-Modus aktivieren',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'title': 'Разрешение',
  'description': 'Выберите режим разрешений по умолчанию для новых сеансов',
  'loading': 'Загрузка',
  'unavailable': 'Недоступно',
  'preset.readOnly': 'Только чтение',
  'preset.workspaceWrite': 'Запись в рабочей области',
  'preset.fullAccess': 'Полный доступ',
  'confirm.title': 'Включить полный доступ?',
  'confirm.description': 'Полный доступ позволяет новым сеансам сократить количество шагов подтверждения и напрямую выполнять больше действий, включая конфиденциальные операции, изменение файлов или внешние команды. Используйте его только в том случае, если вы доверяете последующим задачам.',
  'confirm.acknowledge': 'Я понимаю риски и хочу продолжить',
  'confirm.cancel': 'Отмена',
  'confirm.enable': 'Включить полный доступ',
  'auto.label': 'Авто',
  'auto.confirm.title': 'Включить авторежим?',
  'auto.confirm.description': 'Авторежим работает без песочницы. Перед каждым вызовом встроенного инструмента и внутренним вызовом PTC та же модель, что и текущий агент, проверяет, разрешить ли вызов; вы одобряете или отклоняете каждый отклонённый вызов. Проверка может ошибочно разрешать или запрещать действия и использует дополнительные токены.',
  'auto.confirm.acknowledge': 'Я понимаю эти риски и хочу продолжить',
  'auto.confirm.enable': 'Включить авторежим',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'title': 'Permissão',
  'description': 'Escolha o modo de permissão padrão para novas sessões',
  'loading': 'Carregando',
  'unavailable': 'Indisponível',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no espaço de trabalho',
  'preset.fullAccess': 'Acesso total',
  'confirm.title': 'Ativar acesso total?',
  'confirm.description': 'O acesso total permite que novas sessões reduzam as etapas de confirmação e executem mais ações diretamente, incluindo operações confidenciais, alterações de arquivos ou comandos externos. Use-o apenas quando confiar nas tarefas subsequentes.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar acesso total',
  'auto.label': 'Automático',
  'auto.confirm.title': 'Ativar o modo automático?',
  'auto.confirm.description': 'O modo automático é executado sem sandbox. Antes de cada chamada de ferramenta nativa e chamada interna PTC, o mesmo modelo do agente atual analisa se deve permitir; você aprova ou rejeita cada chamada negada. A revisão pode permitir ou negar ações por engano e usa tokens adicionais.',
  'auto.confirm.acknowledge': 'Entendo esses riscos e quero continuar',
  'auto.confirm.enable': 'Ativar o modo automático',
} satisfies Record<keyof typeof en, string>

/** Japanese copy, checked against the English keys. */
export const accessJa = {
  'mode': 'アクセスモード、現在: {name}',
  'close': '閉じる',
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
  'confirm.title': 'フルアクセスを有効にしますか？',
  'confirm.description': 'フルアクセスでは確認ステップが減り、エージェントが機密操作・ファイル変更・外部コマンドなど多くの操作を直接実行できるようになります。現在のタスクを信頼できる場合にのみ使用してください。',
  'confirm.acknowledge': 'リスクを理解し、続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'フルアクセスを有効にする',
  'auto.label': '自動',
  'auto.description': 'サンドボックスなしで実行し、ネイティブツール呼び出しと PTC 内部呼び出しのたびに同じモデルが許可可否をレビューします。',
  'auto.confirm.title': '自動モードを有効にしますか？',
  'auto.confirm.description': '自動モードはサンドボックスなしで実行されます。ネイティブツール呼び出しと PTC 内部呼び出しのたびに、現在のエージェントと同じモデルが許可可否をレビューし、拒否された呼び出しはあなたが承認または却下します。レビューは操作を誤って許可・拒否する可能性があり、追加のトークンを消費します。',
  'auto.confirm.acknowledge': 'これらのリスクを理解し、続行します',
  'auto.confirm.enable': '自動モードを有効にする',
} satisfies Record<keyof typeof accessEn, string>

/** Spanish dictionary, checked against the English keys. */
export const accessEs = {
  'mode': 'Modo de acceso, actual: {name}',
  'close': 'Cerrar',
  'preset.readOnly': 'Sólo lectura',
  'preset.workspaceWrite': 'Escritura en el espacio de trabajo',
  'preset.fullAccess': 'Acceso completo',
  'confirm.title': '¿Habilitar acceso completo?',
  'confirm.description': 'El acceso completo reduce los pasos de confirmación y permite al agente realizar más acciones directamente, incluidas operaciones confidenciales, cambios de archivos o comandos externos. Úselo solo cuando confíe en la tarea actual.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar.',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Habilitar acceso completo',
  'auto.label': 'Automático',
  'auto.description': 'Ejecute sin zona de pruebas; antes de cada llamada a herramienta nativa y llamada interna PTC, el mismo modelo revisa si se permite.',
  'auto.confirm.title': '¿Habilitar el modo automático?',
  'auto.confirm.description': 'El modo automático se ejecuta sin zona de pruebas. Antes de cada llamada a herramienta nativa y llamada interna PTC, el mismo modelo que el agente actual revisa si se permite; usted aprueba o rechaza cada llamada que rechaza. La revisión puede permitir o denegar acciones erróneamente y utiliza tokens adicionales.',
  'auto.confirm.acknowledge': 'Entiendo estos riesgos y quiero continuar',
  'auto.confirm.enable': 'Habilitar el modo automático',
} satisfies typeof accessEn

/** French dictionary, checked against the English keys. */
export const accessFr = {
  'mode': "Mode d'accès, actuel : {name}",
  'close': 'Fermer',
  'preset.readOnly': 'Lecture seule',
  'preset.workspaceWrite': "Écriture dans l'espace de travail",
  'preset.fullAccess': 'Accès complet',
  'confirm.title': "Activer l'accès complet ?",
  'confirm.description': "L'accès complet réduit les étapes de confirmation et permet à l'agent d'effectuer directement davantage d'actions, notamment des opérations sensibles, des modifications de fichiers ou des commandes externes. Utilisez-le uniquement lorsque vous faites confiance à la tâche en cours.",
  'confirm.acknowledge': 'Je comprends les risques et je veux continuer',
  'confirm.cancel': 'Annuler',
  'confirm.enable': "Activer l'accès complet",
  'auto.label': 'Auto',
  'auto.description': 'Exécutez sans bac à sable ; avant chaque appel d\'outil natif et appel interne PTC, le même modèle vérifie s\'il doit l\'autoriser.',
  'auto.confirm.title': 'Activer le mode auto ?',
  'auto.confirm.description': 'Le mode auto fonctionne sans bac à sable. Avant chaque appel d\'outil natif et appel interne PTC, le même modèle que l\'agent actuel vérifie s\'il doit l\'autoriser ; vous approuvez ou rejetez chaque appel qu\'il refuse. L\'examen peut autoriser ou refuser une action à tort et utilise des jetons supplémentaires.',
  'auto.confirm.acknowledge': 'Je comprends ces risques et je veux continuer',
  'auto.confirm.enable': 'Activer le mode auto',
} satisfies typeof accessEn

/** German dictionary, checked against the English keys. */
export const accessDe = {
  'mode': 'Zugriffsmodus, aktuell: {name}',
  'close': 'Schließen',
  'preset.readOnly': 'Nur lesen',
  'preset.workspaceWrite': 'Arbeitsbereich schreiben',
  'preset.fullAccess': 'Voller Zugriff',
  'confirm.title': 'Vollzugriff aktivieren?',
  'confirm.description': 'Durch den Vollzugriff werden Bestätigungsschritte reduziert und der Agent kann mehr Aktionen direkt ausführen, einschließlich vertraulicher Vorgänge, Dateiänderungen oder externer Befehle. Verwenden Sie es nur, wenn Sie der aktuellen Aufgabe vertrauen.',
  'confirm.acknowledge': 'Ich verstehe die Risiken und möchte weitermachen',
  'confirm.cancel': 'Abbrechen',
  'confirm.enable': 'Aktivieren Sie Vollzugriff',
  'auto.label': 'Auto',
  'auto.description': 'Ausführung ohne Sandbox; vor jedem nativen Toolaufruf und PTC-Innenaufruf prüft dasselbe Modell, ob er zulässig ist.',
  'auto.confirm.title': 'Auto-Modus aktivieren?',
  'auto.confirm.description': 'Der Auto-Modus läuft ohne Sandbox. Vor jedem nativen Tool-Aufruf und PTC-Innenaufruf prüft dasselbe Modell wie der aktuelle Agent, ob der Aufruf zulässig ist; Sie genehmigen oder lehnen jeden abgelehnten Aufruf ab. Eine Prüfung kann Aktionen fälschlicherweise zulassen oder verweigern und verbraucht zusätzliche Token.',
  'auto.confirm.acknowledge': 'Ich verstehe diese Risiken und möchte weitermachen',
  'auto.confirm.enable': 'Auto-Modus aktivieren',
} satisfies typeof accessEn

/** Russian dictionary, checked against the English keys. */
export const accessRu = {
  'mode': 'Режим доступа, текущий: {name}',
  'close': 'Закрыть',
  'preset.readOnly': 'Только чтение',
  'preset.workspaceWrite': 'Запись в рабочей области',
  'preset.fullAccess': 'Полный доступ',
  'confirm.title': 'Включить полный доступ?',
  'confirm.description': 'Полный доступ сокращает количество шагов подтверждения и позволяет агенту напрямую выполнять больше действий, включая конфиденциальные операции, изменения файлов или внешние команды. Используйте его только в том случае, если вы доверяете текущей задаче.',
  'confirm.acknowledge': 'Я понимаю риски и хочу продолжить',
  'confirm.cancel': 'Отмена',
  'confirm.enable': 'Включить полный доступ',
  'auto.label': 'Авто',
  'auto.description': 'Запуск без песочницы; перед каждым вызовом встроенного инструмента и внутренним вызовом PTC та же модель проверяет, разрешить ли его.',
  'auto.confirm.title': 'Включить авторежим?',
  'auto.confirm.description': 'Авторежим работает без песочницы. Перед каждым вызовом встроенного инструмента и внутренним вызовом PTC та же модель, что и текущий агент, проверяет, разрешить ли вызов; вы одобряете или отклоняете каждый отклонённый вызов. Проверка может ошибочно разрешать или запрещать действия и использует дополнительные токены.',
  'auto.confirm.acknowledge': 'Я понимаю эти риски и хочу продолжить',
  'auto.confirm.enable': 'Включить авторежим',
} satisfies typeof accessEn

/** Portuguese dictionary, checked against the English keys. */
export const accessPt = {
  'mode': 'Modo de acesso, atual: {name}',
  'close': 'Fechar',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no espaço de trabalho',
  'preset.fullAccess': 'Acesso total',
  'confirm.title': 'Ativar acesso total?',
  'confirm.description': 'O acesso total reduz as etapas de confirmação e permite que o agente execute mais ações diretamente, incluindo operações confidenciais, alterações de arquivos ou comandos externos. Use-o apenas quando confiar na tarefa atual.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar acesso total',
  'auto.label': 'Automático',
  'auto.description': 'Execute sem sandbox; antes de cada chamada de ferramenta nativa e chamada interna PTC, o mesmo modelo revisa se deve permitir.',
  'auto.confirm.title': 'Ativar o modo automático?',
  'auto.confirm.description': 'O modo automático é executado sem sandbox. Antes de cada chamada de ferramenta nativa e chamada interna PTC, o mesmo modelo do agente atual analisa se deve permitir; você aprova ou rejeita cada chamada negada. A revisão pode permitir ou negar ações por engano e usa tokens adicionais.',
  'auto.confirm.acknowledge': 'Entendo esses riscos e quero continuar',
  'auto.confirm.enable': 'Ativar o modo automático',
} satisfies typeof accessEn
