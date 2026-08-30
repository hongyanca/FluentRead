<!--
 * @file src/features/settings/ui/SettingsSections.vue
 * 文件职责：承载 FluentRead Options 页面各业务设置分区，连接运行时配置、服务选择、快捷键、站点规则、翻译中心、OCR、词书以及导入导出和历史恢复。
 * 主要内容：模板按 activeSection 展示常规、外观、服务、视频、隐私等控件；脚本协调配置快照保存、加密凭据保存、历史游标、能力过滤、连接测试、文件传输和页面离开 flush。
 * 模块边界：该组件负责设置 UI 编排但不实现 provider 网络、配置仓库或 feature 运行时；校验与迁移来自 core/config，持久化经 services/config，复杂子界面保持在各自 feature/组件内。
 -->
<template>
  <section v-show="props.activeSection === 'settings-general'" id="settings-general" class="settings-section">
    <SettingsGroup>
      <SettingsItem
        label="插件状态"
        :description="config.on ? '网页翻译和快捷功能正在运行。' : '当前已暂停，其他偏好仍可继续调整。'"
      >
        <el-switch v-model="config.on" class="settings-switch" aria-label="插件状态" @change="handlePluginStateChange" />
      </SettingsItem>
      <SettingsItem label="默认目标语言" description="网页、划词和悬停翻译默认翻译成的语言。">
        <el-select v-model="config.to" aria-label="默认目标语言" placeholder="请选择目标语言">
          <el-option v-for="item in options.to" :key="item.value" class="select-left" :label="item.label" :value="item.value" />
        </el-select>
      </SettingsItem>
      <SettingsItem label="界面主题" description="只影响扩展界面，不会改变网页本身的配色。">
        <SegmentedControl v-model="config.theme" :options="options.theme" label="界面主题" />
      </SettingsItem>
    </SettingsGroup>
    <SettingsGroup title="选择翻译服务" description="设置网页翻译默认使用的服务；模型和凭据仍在“翻译服务”页配置。">
      <SettingsItem label="默认网页翻译服务" description="全文、悬浮和划词翻译默认使用此服务。">
        <div
          class="service-default-control"
          data-testid="default-translation-service-card"
          :data-default-service="config.service"
        >
          <ServiceIcon :service="config.service" :label="defaultTextServiceLabel" size="medium" />
          <el-select v-model="config.service" aria-label="默认网页翻译服务" placeholder="请选择翻译服务">
            <el-option v-if="selectedTextServiceUnavailableMessage" label="Chrome内置AI翻译（当前浏览器不可用）" :value="config.service" disabled />
            <el-option v-for="item in availableServiceOptions" :key="item.value" class="select-left" :label="item.label" :value="item.value" :disabled="item.disabled" />
          </el-select>
        </div>
      </SettingsItem>
    </SettingsGroup>
    <div v-if="selectedTextServiceUnavailableMessage" class="disabled-section" role="status">
      <strong>当前默认服务在此浏览器不可用</strong>
      <p>{{ selectedTextServiceUnavailableMessage }}请在上方选择可用服务。</p>
    </div>
  </section>
  <section v-show="props.activeSection === 'settings-sites'" id="settings-sites" class="settings-section site-settings-section">
    <SettingsGroup>
      <SettingsItem label="所有网站自动翻译" description="每个支持的网页加载完成后自动开始翻译；关闭后仍保留下面的名单。">
        <el-switch v-model="config.autoTranslate" class="settings-toggle" aria-label="所有网站自动翻译" />
      </SettingsItem>
    </SettingsGroup>
    <AlwaysTranslateSites v-model="config.alwaysTranslateDomains" />
    <AlwaysTranslateSites v-model="config.disabledExtensionDomains" variant="disable-extension" />
  </section>
  <section v-show="props.activeSection === 'settings-translation-center'" id="settings-translation-center" class="settings-section translation-center-section">
    <TranslationCenter />
  </section>
  <div class="settings-main-sections">
    <!-- 翻译服务 -->
    <section v-show="props.activeSection === 'settings-services'" id="settings-services" class="settings-section">
      <ServiceCatalog
        :service="selectedConfigurationService"
        :default-service="config.service"
        :selected-model="config.model[selectedConfigurationService]"
        :services="configurationCompute.filteredServices"
        :model-options="configurationCompute.model"
        :custom-models="config.customModel"
        :show-model="configurationCompute.showModel"
        @update:service="setConfigurationService"
        @update:model="config.model[selectedConfigurationService] = $event"
      >
        <template #configuration>
          <ServiceConfiguration
            :config="config"
            :service="selectedConfigurationService"
            :compute="configurationCompute"
            :options="options"
            :is-valid-azure-endpoint="isValidAzureEndpoint"
          />
        </template>
      </ServiceCatalog>
    </section>
    <section v-show="props.activeSection === 'settings-image-translation'" id="settings-image-translation" class="settings-section image-translation-settings">
      <SettingsGroup title="功能状态" description="图片翻译与圈选翻译共用本地 OCR 语言包，但可以分别开启。">
        <SettingsItem label="网页图片翻译" description="悬停网页图片时显示翻译入口，默认关闭。">
          <el-switch v-model="imageTranslationEnabled" class="settings-toggle" aria-label="网页图片翻译" />
        </SettingsItem>
        <SettingsItem label="圈选区域翻译" description="截取你主动圈选的屏幕区域进行 OCR 和翻译。">
          <el-switch v-model="selectionAreaTranslationEnabled" class="settings-toggle" aria-label="圈选区域翻译" />
        </SettingsItem>
      </SettingsGroup>
      <ImageOcrSettings />
    </section>
    <section v-show="props.activeSection === 'settings-video'" id="settings-video" class="settings-section">
      <SettingsGroup>
        <SettingsItem label="视频字幕翻译" description="翻译 YouTube 已提供的字幕文本，不上传音频或视频内容。">
          <el-switch v-model="config.videoTranslationEnabled" class="settings-switch" aria-label="视频字幕翻译" />
        </SettingsItem>
        <SettingsItem label="视频翻译服务" description="与网页翻译服务相互独立；AI 服务会提前预取字幕。" :disabled="!config.videoTranslationEnabled">
          <el-select v-model="config.videoService" aria-label="视频字幕翻译服务" :disabled="!config.videoTranslationEnabled" placeholder="请选择服务">
            <el-option v-if="selectedVideoServiceUnavailableMessage" label="Chrome内置AI翻译（当前浏览器不可用）" :value="config.videoService" disabled />
            <el-option v-for="item in videoServiceOptions" :key="item.value" class="select-left" :label="item.label" :value="item.value" />
          </el-select>
          <p v-if="selectedVideoServiceUnavailableMessage" class="capability-warning">{{ selectedVideoServiceUnavailableMessage }}</p>
        </SettingsItem>
        <SettingsItem label="显示 FluentRead 字幕" description="临时隐藏扩展字幕时保留当前翻译设置。" :disabled="!config.videoTranslationEnabled">
          <el-switch v-model="config.videoSubtitleVisible" class="settings-toggle" aria-label="显示 FluentRead 视频字幕" :disabled="!config.videoTranslationEnabled" />
        </SettingsItem>
        <SettingsItem label="字幕显示模式" description="选择同时显示原文和译文，或只显示其中一种。" :disabled="!config.videoTranslationEnabled || !config.videoSubtitleVisible">
          <SegmentedControl
            v-model="config.videoSubtitleDisplayMode"
            :options="videoSubtitleDisplayModeOptions"
            label="视频字幕显示模式"
            :disabled="!config.videoTranslationEnabled || !config.videoSubtitleVisible"
          />
        </SettingsItem>
        <SettingsItem label="字幕字号" description="只调整 FluentRead 字幕，不改变 YouTube 原生字幕。" :disabled="!config.videoTranslationEnabled || !config.videoSubtitleVisible">
          <el-select v-model="config.videoSubtitleFontSize" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled" placeholder="请选择字号">
            <el-option v-for="size in videoSubtitleFontSizeOptions" :key="size" class="select-left" :label="size === 100 ? '默认' : `${size}%`" :value="size" />
          </el-select>
        </SettingsItem>
      </SettingsGroup>
      <details class="feature-help">
        <summary>使用说明</summary>
        <p>打开 YouTube 原生字幕后，FluentRead 会在播放器中显示译文。机器翻译约提前 10 秒、AI 服务约提前 30 秒准备字幕；播放器菜单可分别下载原文或译文 SRT。</p>
      </details>
    </section>



    <!-- 鼠标悬浮快捷键 -->
    <section v-show="props.activeSection === 'settings-translation'" id="settings-translation" class="settings-section">
    <SettingsGroup title="鼠标悬浮翻译" description="按住快捷键并把鼠标移到文本上，等待设定时间后开始翻译。">
    <el-row class="settings-control-row" :class="{ 'custom-hotkey-row': config.hotkey === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按住指定快捷键并悬停在文本上进行翻译" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          鼠标悬浮快捷键
          <el-icon class="icon-margin">
            <InfoFilled />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.hotkey" 
            aria-label="鼠标悬浮快捷键"
            placeholder="请选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleMouseHotkeyChange"
          >
            <el-option v-for="item in options.keys" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.hotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customHotkey">
              {{ getCustomMouseHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button
              size="small"
              type="text"
              class="edit-button"
              aria-label="编辑鼠标悬浮快捷键"
              title="编辑鼠标悬浮快捷键"
              @click="openCustomMouseHotkeyDialog"
            >
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 鼠标悬浮翻译延迟 -->
    <el-row class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按住鼠标悬浮快捷键并移动鼠标后，等待指定时间再翻译；调高可以减少 Ctrl+C 等组合键带来的误触。松开快捷键触发的单次翻译不受影响。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            悬浮翻译延迟
            <el-icon class="icon-margin"><InfoFilled /></el-icon>
          </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end translation-delay-field">
        <el-input-number
          v-model="config.mouseHoverTranslationDelay"
          aria-label="悬浮翻译延迟"
          :min="MOUSE_HOVER_TRANSLATION_DELAY_MIN"
          :max="MOUSE_HOVER_TRANSLATION_DELAY_MAX"
          :step="MOUSE_HOVER_TRANSLATION_DELAY_STEP"
          controls-position="right"
          @change="handleMouseHoverTranslationDelayChange"
        />
        <span class="input-suffix">ms</span>
      </el-col>
    </el-row>

    </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-translation'" class="settings-section settings-section-continuation">
    <SettingsGroup title="划词翻译" description="选择文字后的展示内容、触发方式和等待时间。">
    <!-- 划词翻译模式选择 -->
    <el-row class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选中文本后显示翻译入口；可选择直接弹出、图标、小点、预设快捷键或自定义快捷键。" placement="top-start" :show-after="500">
      <span class="popup-text popup-vertical-left">
        划词翻译
        <el-icon class="icon-margin">
          <InfoFilled />
        </el-icon>
      </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <SegmentedControl v-model="config.selectionTranslatorMode" :options="selectionTranslatorModeOptions" label="划词翻译模式" />
      </el-col>
    </el-row>
    <el-row v-if="config.selectionTranslatorMode !== 'disabled'" class="settings-control-row" :class="{ 'custom-hotkey-row': config.selectionTranslatorTrigger === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="快捷键与直接弹出、显示图标和显示小点是并列的触发方式；选择快捷键后，选中文字时不会显示图标或小点。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            划词触发方式
            <el-icon class="icon-margin"><InfoFilled /></el-icon>
          </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select v-model="config.selectionTranslatorTrigger" aria-label="划词翻译触发方式" placeholder="选择触发方式" size="small" style="width: 100%" @change="handleSelectionTriggerChange">
            <el-option v-for="item in options.selectionTranslatorTriggers" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <div v-if="config.selectionTranslatorTrigger === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customSelectionTranslatorHotkey">
              {{ getCustomSelectionHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button
              size="small"
              type="text"
              class="edit-button"
              aria-label="编辑划词翻译快捷键"
              title="编辑划词翻译快捷键"
              @click="openCustomSelectionHotkeyDialog"
            >
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>
    <el-row v-if="config.selectionTranslatorMode !== 'disabled'" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="从选区稳定后开始计时，再显示图标、小点或翻译面板；快捷键在等待结束后按下会立即显示。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            划词显示延迟
            <el-icon class="icon-margin"><InfoFilled /></el-icon>
          </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end translation-delay-field">
        <el-input-number
          v-model="config.selectionTranslatorDelay"
          aria-label="划词翻译显示延迟"
          :min="SELECTION_TRANSLATOR_DELAY_MIN"
          :max="SELECTION_TRANSLATOR_DELAY_MAX"
          :step="SELECTION_TRANSLATOR_DELAY_STEP"
          controls-position="right"
          @change="handleSelectionTranslatorDelayChange"
        />
        <span class="input-suffix">ms</span>
      </el-col>
    </el-row>
    </SettingsGroup>
    </section>

    <!-- 高级选项 -->
    <section v-show="props.activeSection === 'settings-advanced'" id="settings-advanced" class="settings-section">
      <SettingsGroup title="缓存策略" description="减少重复请求；需要最新结果时可临时关闭。">
        <!-- 缓存开关 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="开启缓存可以提高翻译速度，减少重复请求，但可能导致翻译结果不是最新的" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">缓存翻译结果<el-icon class="icon-margin">
            <InfoFilled />
          </el-icon></span>
            </el-tooltip>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.useCache" class="settings-toggle" aria-label="缓存翻译结果" />
          </el-col>
        </el-row>

      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-general'" class="settings-section settings-section-continuation">
      <SettingsGroup title="译文显示" description="设置网页翻译后的内容形式和双语译文样式。">
        <SettingsItem label="翻译模式" description="双语对照保留原文，仅译文模式会替换原文显示。">
          <SegmentedControl v-model="config.display" :options="options.display" label="翻译模式" />
        </SettingsItem>
        <SettingsItem label="输出过滤" description="使用正则表达式移除翻译结果中的匹配内容，再注入网页；留空表示不过滤。">
          <div class="output-filter-control">
            <el-input
              v-model="config.outputFilter"
              type="textarea"
              :rows="3"
              placeholder="例如：<\|channel>.*?<channel\|>"
              :class="{ 'input-error': config.outputFilter && !isValidOutputFilterRegex(config.outputFilter) }"
            />
            <div v-if="config.outputFilter && !isValidOutputFilterRegex(config.outputFilter)" class="error-text">
              正则表达式格式不正确，请检查语法
            </div>
            <div v-else-if="config.outputFilter" class="output-filter-success">
              正则表达式有效，将使用 gs 标志移除全部匹配项
            </div>
          </div>
        </SettingsItem>
        <SettingsItem v-show="config.display === 1" label="译文样式" description="选择后可在下方立即查看效果。">
          <el-select v-model="config.style" aria-label="译文样式" placeholder="请选择译文显示样式">
            <el-option-group v-for="group in styleGroups" :key="group.value" :label="group.label">
              <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value" :class="item.class" />
            </el-option-group>
          </el-select>
        </SettingsItem>
        <div v-show="config.display === 1" class="style-preview-card" aria-live="polite">
          <div class="style-preview-example">
            <p class="style-preview-source">Reading should feel calm and effortless.</p>
            <p :key="config.style" class="style-preview-text" :class="currentStyleClass">阅读应该轻松、自然，不打断你的节奏。</p>
          </div>
        </div>
      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-general'" class="settings-section settings-section-continuation">
      <SettingsGroup title="网页辅助" description="控制全文翻译时显示的工具和 AI 语境增强。">
        <!-- AI 智能上下文 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label ai-context-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="开启后，AI 翻译会参考当前网页的标题、描述和相关正文片段；仅对大模型翻译服务生效。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">AI 智能上下文<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
            <small class="settings-control-hint">可提前开启；仅在支持的 AI 服务下采集网页语境并生效，其他服务会保留此偏好但不会发送上下文。</small>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.enableAIContext" class="settings-toggle" aria-label="AI 智能上下文" />
          </el-col>
        </el-row>

        <!-- 悬浮球开关 -->
      <el-row class="settings-control-row">
        <el-col :span="20" class="settings-control-label lightblue rounded-corner">
          <el-tooltip class="box-item" effect="dark" content="（测试版）控制是否显示屏幕边缘的即时翻译悬浮球，用于对整个网页进行翻译" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            全文翻译悬浮球
            <el-icon class="icon-margin">
              <InfoFilled />
            </el-icon>
          </span>
          </el-tooltip>
        </el-col>

        <el-col :span="4" class="settings-control-field flex-end">
          <el-switch v-model="floatingBallEnabled" class="settings-toggle" aria-label="全文翻译悬浮球" />
        </el-col>
      </el-row>

        <!-- 翻译进度面板 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip
              class="box-item"
              effect="dark"
              content="全文翻译时，在网页右下角显示正在翻译和等待中的任务数量；任务结束后自动隐藏。"
              placement="top-start"
              :show-after="500"
            >
              <span class="popup-text popup-vertical-left">
                显示翻译进度面板
                <el-icon class="icon-margin"><InfoFilled /></el-icon>
              </span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch
              v-model="config.translationProgressPanelEnabled"
              class="settings-toggle"
              aria-label="显示翻译进度面板"
              @change="handleTranslationProgressPanelChange"
            />
          </el-col>
        </el-row>

      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-advanced'" class="settings-section settings-section-continuation">
      <SettingsGroup title="界面性能" description="低配置设备可以关闭动画以减少资源占用。">
        <!-- 禁用动画设置 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="动画效果（默认开）：禁用后将关闭加载/悬浮等动画，以节省GPU资源和电量。适合低配置设备或希望节省资源的用户。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">动画效果<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.animations" class="settings-toggle" aria-label="动画效果" />
          </el-col>
        </el-row>

      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-translation'" class="settings-section settings-section-continuation">
      <SettingsGroup title="输入框翻译" description="在网页输入框中输入触发字符，快速翻译正在编辑的内容。">
        <!-- 输入框翻译功能 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="输入框翻译：在任何文本输入框中使用指定方式触发翻译当前输入的内容。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">输入框翻译<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTrigger" aria-label="输入框翻译触发方式" placeholder="请选择触发方式">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTrigger" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 输入框翻译目标语言 -->
        <el-row v-if="config.inputBoxTranslationTrigger !== 'disabled'" class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <span class="popup-text popup-vertical-left">翻译目标语言</span>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTarget" aria-label="输入框翻译目标语言" placeholder="请选择目标语言">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTarget" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-translation'" class="settings-section settings-section-continuation">
      <SettingsGroup title="全文翻译" description="设置启动全文翻译的方式、处理范围和网页内入口。">
        <el-row class="settings-control-row" :class="{ 'custom-hotkey-row': config.floatingBallHotkey === 'custom' }">
          <el-col :span="14" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="（测试版）设置快捷键以便快速切换全文翻译状态，无需鼠标点击悬浮球" placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">全文翻译快捷键<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="10" class="settings-control-field flex-end">
            <div class="hotkey-config">
              <el-select v-model="config.floatingBallHotkey" aria-label="全文翻译快捷键" placeholder="选择快捷键" size="small" style="width: 100%" @change="handleHotkeyChange">
                <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <div v-if="config.floatingBallHotkey === 'custom'" class="custom-hotkey-display">
                <span v-if="config.customFloatingBallHotkey" class="hotkey-text">{{ getCustomHotkeyDisplayName() }}</span>
                <span v-else class="hotkey-text placeholder-text">点击设置自定义快捷键</span>
                <el-button size="small" type="text" class="edit-button" aria-label="编辑全文翻译快捷键" title="编辑全文翻译快捷键" @click="openCustomHotkeyDialog">
                  <el-icon><Edit /></el-icon>
                </el-button>
              </div>
            </div>
          </el-col>
        </el-row>

        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="开启后，使用支持通用提示词的 AI 服务进行全文翻译时，会把相邻短段合并为一次请求；机器翻译、悬浮、划词和输入框翻译不受影响。" placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">AI 多段翻译<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.enableAIMultiSegment" class="settings-toggle" aria-label="AI 多段翻译" />
          </el-col>
        </el-row>

        <el-row class="settings-control-row">
          <el-col :span="14" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="按阅读进度会预翻译视口附近内容；立即翻译到网页底部会处理当前已加载的整页内容，并持续翻译之后新增的内容。它不会自动滚动页面，但在无限滚动页面可能产生较多翻译请求和服务费用。设置会在下次启动全文翻译时生效。" placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">全文翻译范围<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="10" class="settings-control-field flex-end">
            <SegmentedControl v-model="config.fullPageTranslationMode" :options="fullPageTranslationModeOptions" label="全文翻译范围" />
          </el-col>
        </el-row>

        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="在网页右键菜单中显示“流畅阅读翻译”或“流畅阅读取消翻译”入口；关闭后不会影响全文翻译快捷键和悬浮球" placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">右键全文翻译<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.contextMenuEnabled" class="settings-toggle" aria-label="右键全文翻译" />
          </el-col>
        </el-row>
      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-advanced'" class="settings-section settings-section-continuation">
      <SettingsGroup title="任务调度" description="并发越高速度可能越快，也会增加资源占用和服务限流风险。">
        <!-- 翻译并发数 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="控制同时进行的最大翻译任务数，数值越高翻译速度越快，但可能占用更多系统资源" placement="top-start"
                        :show-after="500">
          <span class="popup-text popup-vertical-left">翻译并发数<el-icon class="icon-margin">
              <InfoFilled />
            </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-input-number
                v-model="config.maxConcurrentTranslations"
                aria-label="翻译并发数"
                :min="1"
                :max="100"
                :step="1"
                style="width: 100%"
                @change="handleConcurrentChange"
                controls-position="right"
            />
          </el-col>
        </el-row>

      </SettingsGroup>
    </section>

    <ModelUsageDashboard
      v-show="props.activeSection === 'settings-model-usage'"
      :active="props.activeSection === 'settings-model-usage'"
    />
    <ConfigManagement v-show="props.activeSection === 'settings-data'" id="settings-data" :config="config" />
  </div>

  <!-- 自定义快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="config.customFloatingBallHotkey"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />

  <!-- 自定义鼠标悬浮快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomMouseHotkeyDialog"
    :current-value="config.customHotkey"
    @confirm="handleCustomMouseHotkeyConfirm"
    @cancel="handleCustomMouseHotkeyCancel"
  />
  <CustomHotkeyInput
    v-model="showCustomSelectionHotkeyDialog"
    :current-value="config.customSelectionTranslatorHotkey"
    @confirm="handleCustomSelectionHotkeyConfirm"
    @cancel="handleCustomSelectionHotkeyCancel"
  />



</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { customModelString, models, options, services, servicesType } from '@/src/core/config/catalog';
import {
  Config,
  MOUSE_HOVER_TRANSLATION_DELAY_MAX,
  MOUSE_HOVER_TRANSLATION_DELAY_MIN,
  MOUSE_HOVER_TRANSLATION_DELAY_STEP,
  SELECTION_TRANSLATOR_DELAY_MAX,
  SELECTION_TRANSLATOR_DELAY_MIN,
  SELECTION_TRANSLATOR_DELAY_STEP,
  VIDEO_SUBTITLE_FONT_SIZE_OPTIONS,
  normalizeConfig,
  normalizeMouseHoverTranslationDelay,
  normalizeSelectionTranslatorDelay,
} from '@/src/core/config/model';
import { InfoFilled, Edit } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import browser from 'webextension-polyfill';
import {isBrowserTabId} from '@/src/platform/browser/ids';
import { defineAsyncComponent } from 'vue';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import ServiceCatalog from './services/ServiceCatalog.vue';
import ServiceConfiguration from './services/ServiceConfiguration.vue';
import {TranslationCenter} from '@/src/features/translation-center/public';
import AlwaysTranslateSites from './AlwaysTranslateSites.vue';
import { parseHotkey } from '@/src/core/hotkey';
import { getApiKeyRequirementKey, getMissingCredentialMessage, isApiKeyRequired } from '@/src/core/config/validation';
import {ImageOcrSettings} from '@/src/features/image-translation/public';
import {ModelUsageDashboard} from '@/src/features/model-usage/public';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
import SegmentedControl from './components/SegmentedControl.vue';
import ConfigManagement from './ConfigManagement.vue';
import {
  config as runtimeConfig,
  configReady,
  requestConfigPatch,
  requestConfigSave,
  subscribeConfig,
} from '@/src/services/config/store';
import {
  filterSelectableTranslationServices,
  getTranslationServiceUnavailableMessage,
} from '@/src/services/translation/capabilities';

const props = withDefaults(defineProps<{
  activeSection?: string
}>(), {
  activeSection: 'settings-general',
})

const isValidOutputFilterRegex = (pattern: string): boolean => {
  if (!pattern.trim()) return true;
  try {
    new RegExp(pattern, 'gs');
    return true;
  } catch {
    return false;
  }
};

// 初始化深色模式媒体查询
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
// 更新主题函数
function updateTheme(theme: string) {
  if (theme === 'auto') {
    // 自动模式下，直接使用系统主题
    document.documentElement.classList.toggle('dark', darkModeMediaQuery.matches);
  } else {
    // 手动模式下，使用选择的主题
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}
// 配置信息
const config = ref(new Config());
const sendConfigMessage = browser.runtime.sendMessage.bind(browser.runtime);
const persistConfigPatch = (value: unknown) => requestConfigPatch(value, sendConfigMessage);
const persistConfigReplace = (value: unknown) => requestConfigSave(value, sendConfigMessage);
let lastSerialized = '';
let hydrated = false;
let applyingExternalConfig = false;
let pageExitSaveStarted = false;
const unsubscribeConfig = subscribeConfig((nextConfig) => {
  const serialized = JSON.stringify(nextConfig);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, nextConfig);
  } finally {
    applyingExternalConfig = false;
  }
});
void configReady
  .then(() => {
    Object.assign(config.value, runtimeConfig);
    lastSerialized = JSON.stringify(config.value);
    hydrated = true;
    updateTheme(config.value.theme || 'auto');
  })
  .catch((error) => console.warn('[FluentRead] 无法读取本地配置', error));

watch(() => JSON.stringify(config.value), (serialized) => {
  if (!hydrated || applyingExternalConfig) return;
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const snapshot = normalizeConfig(config.value);
  void persistConfigPatch(snapshot).catch((error) => {
    // 失败时释放去重标记，下一次修改或 pagehide 仍能提交最新快照。
    if (lastSerialized === serialized) lastSerialized = '';
    console.warn('[FluentRead] 保存设置失败', error);
  });
}, { flush: 'sync' });

// 设置页关闭前 best-effort 补交最终快照；页面仍可能在消息真正发送前销毁。
// pagehide 和 unmounted 可能连续触发，只提交一次，避免重复写入和重复历史。
// revision 边界会拒绝过期 replace，普通交互则始终使用字段 patch。
function persistOnPageExit() {
  if (!hydrated || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void persistConfigReplace(config.value).catch((error) => console.warn('[FluentRead] 设置页关闭前后台保存失败', error));
}

onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
});

function saveOnPageHide() {
  persistOnPageExit();
}
window.addEventListener('pagehide', saveOnPageHide);

// 设置页左侧列表只切换正在编辑的服务，不改变网页翻译实际使用的默认服务。
const configurationService = ref<string | null>(null);
const selectedConfigurationService = computed(
  () => configurationService.value ?? config.value.service,
);

const setConfigurationService = (value: string) => {
  configurationService.value = value;
};

type ServiceSource = { value: string };

const availableServiceOptions = computed(() => filterSelectableTranslationServices(options.services));
const defaultTextServiceLabel = computed(() => (
  options.services.find((item: any) => item.value === config.value.service)?.label || config.value.service
));
const videoServiceOptions = computed(() => availableServiceOptions.value.filter((item: any) => !item.disabled));
const selectedTextServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.value.service));
const selectedVideoServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.value.videoService));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const fullPageTranslationModeOptions = [
  {value: 'viewport', label: '按阅读进度'},
  {value: 'all', label: '翻译到页底'},
];
const selectionTranslatorModeOptions = [
  {value: 'disabled', label: '关闭'},
  {value: 'bilingual', label: '双语'},
  {value: 'translation-only', label: '仅译文'},
];
const videoSubtitleDisplayModeOptions = [
  {value: 'bilingual', label: '双语'},
  {value: 'translation-only', label: '仅译文'},
  {value: 'original-only', label: '仅原文'},
];
const filteredServices = computed(() =>
  availableServiceOptions.value.filter((item: any) =>
    !([item.google].includes(item.value) && config.value.display !== 1),
  ),
);

// 两个页面都需要相同的服务能力判断，但数据源不同：实际翻译使用默认服务，
// 设置页右侧表单使用正在配置的服务。统一从这里生成，避免两套逻辑继续漂移。
const createServiceCompute = (serviceSource: ServiceSource) => ({
  showAI: computed(() => servicesType.isAI(serviceSource.value)),
  showMachine: computed(() => servicesType.isMachine(serviceSource.value)),
  showProxy: computed(() => servicesType.isUseProxy(serviceSource.value)),
  showModel: computed(() => servicesType.isUseModel(serviceSource.value)),
  showCustomBody: computed(() => servicesType.isUseCustomBody(serviceSource.value)),
  showToken: computed(() => servicesType.isUseToken(serviceSource.value)),
  requireApiKey: computed({
    get: () => isApiKeyRequired(serviceSource.value, config.value),
    set: (value: boolean) => {
      config.value.requireApiKey[getApiKeyRequirementKey(serviceSource.value, config.value)] = value;
    },
  }),
  credentialWarning: computed(() => getMissingCredentialMessage(serviceSource.value, config.value)),
  showAkSk: computed(() => servicesType.isUseAkSk(serviceSource.value)),
  showYoudao: computed(() => servicesType.isYoudao(serviceSource.value)),
  showTencent: computed(() => servicesType.isTencent(serviceSource.value)),
  model: computed(() => models.get(serviceSource.value) || []),
  showCustom: computed(() => servicesType.isCustom(serviceSource.value)),
  showDeepLX: computed(() => serviceSource.value === 'deeplx'),
  showMiniMaxRegion: computed(() => serviceSource.value === services.minimax),
  showMiMoRegion: computed(() => serviceSource.value === services.mimo),
  showCustomModel: computed(
    () =>
      servicesType.isAI(serviceSource.value) &&
      config.value.model[serviceSource.value] === customModelString,
  ),
  filteredServices,
  showNewAPI: computed(() => servicesType.isNewApi(serviceSource.value)),
  showAzureOpenaiEndpoint: computed(() => servicesType.isAzureOpenai(serviceSource.value)),
  showDeepseekApiType: computed(() => serviceSource.value === 'deepseek'),
  showDeepseekThinkingMode: computed(
    () => serviceSource.value === 'deepseek' && config.value.deepseekApiType !== 'responses',
  ),
});

// config.service 仍表示实际默认翻译服务；这里仅用于设置页正在编辑的服务。
const configurationCompute = ref(createServiceCompute(selectedConfigurationService));

// 监听主题变化
watch(() => config.value.theme, (newTheme) => {
  updateTheme(newTheme || 'auto');
});

// 使用 onchange 监听系统主题变化
darkModeMediaQuery.onchange = () => {
  if (config.value.theme === 'auto') {
    updateTheme('auto');
  }
};

// 组件卸载时清理
onUnmounted(() => {
  darkModeMediaQuery.onchange = null;
  unsubscribeConfig();
});

// 计算样式分组
const styleGroups = computed(() => {
  const groups = options.styles.filter(item => item.disabled);
  return groups.map(group => ({
    ...group,
    options: options.styles.filter(item => !item.disabled && item.group === group.value)
  }));
});

const currentStyleClass = computed(() =>
  options.styles.find(item => item.value === config.value.style && !item.disabled)?.class || 'fluent-display-default'
);

// 悬浮球开关的计算属性
const floatingBallEnabled = computed({
  get: () => !config.value.disableFloatingBall,
  set: (value) => {
    config.value.disableFloatingBall = !value;
    // 向所有激活的标签页发送消息
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (isBrowserTabId(tab.id)) {
          browser.tabs.sendMessage(tab.id, { 
            type: 'toggleFloatingBall',
            isEnabled: value && config.value.on,
          }).catch(() => {
            // 忽略发送失败的错误（可能是页面未加载内容脚本）
          });
        }
      });
    });
  }
});

const imageTranslationEnabled = computed({
  get: () => !config.value.disableImageTranslator,
  set: (value) => {
    config.value.disableImageTranslator = !value;
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (!isBrowserTabId(tab.id)) return;
        browser.tabs.sendMessage(tab.id, {
          type: 'toggleImageTranslator',
          isEnabled: value && config.value.on,
        }).catch(() => undefined);
      });
    }).catch(() => undefined);
  },
});

const selectionAreaTranslationEnabled = computed({
  get: () => config.value.selectionAreaEnabled,
  set: (value) => {
    config.value.selectionAreaEnabled = value;
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (!isBrowserTabId(tab.id)) return;
        browser.tabs.sendMessage(tab.id, {
          type: 'toggleSelectionAreaTranslator',
          isEnabled: value && config.value.on,
        }).catch(() => undefined);
      });
    }).catch(() => undefined);
  },
});

const handleTranslationProgressPanelChange = (isEnabled: boolean) => {
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!isBrowserTabId(tab.id)) return;
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleTranslationProgressPanel',
        isEnabled,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
    });
  }).catch(() => {
    // 忽略无法查询标签页的错误，配置仍会通过统一存储链路保存
  });
};

// 监听划词翻译模式变化
watch(() => config.value.selectionTranslatorMode, (newMode) => {
  config.value.disableSelectionTranslator = newMode === 'disabled';
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (isBrowserTabId(tab.id)) {
        browser.tabs.sendMessage(tab.id, { 
        type: 'updateSelectionTranslatorMode',
        mode: config.value.on ? newMode : 'disabled',
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
});

// 处理插件状态变化
const handlePluginStateChange = (val: boolean) => {
  // 总开关只控制当前运行状态，不覆盖用户对悬浮球和划词翻译的偏好。
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!isBrowserTabId(tab.id)) return;
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleFloatingBall',
        isEnabled: val && !config.value.disableFloatingBall,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
      browser.tabs.sendMessage(tab.id, {
        type: 'updateSelectionTranslatorMode',
        mode: val ? config.value.selectionTranslatorMode : 'disabled',
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleSelectionAreaTranslator',
        isEnabled: val && config.value.selectionAreaEnabled,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
    });
  });
};

// 自定义快捷键相关
const showCustomHotkeyDialog = ref(false);
const showCustomMouseHotkeyDialog = ref(false);
const showCustomSelectionHotkeyDialog = ref(false);

// 处理快捷键选择变化
const handleHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customFloatingBallHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义快捷键对话框
const openCustomHotkeyDialog = () => {
  showCustomHotkeyDialog.value = true;
};

// 确认自定义快捷键
const handleCustomHotkeyConfirm = (hotkey: string) => {
  config.value.customFloatingBallHotkey = hotkey;
  config.value.floatingBallHotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义快捷键
const handleCustomHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customFloatingBallHotkey) {
    config.value.floatingBallHotkey = 'Alt+T';
  }
};

// 获取自定义快捷键显示名称
const getCustomHotkeyDisplayName = () => {
  if (!config.value.customFloatingBallHotkey) return '';
  
  if (config.value.customFloatingBallHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customFloatingBallHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customFloatingBallHotkey;
};

// 处理鼠标悬浮快捷键选择变化
const handleMouseHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomMouseHotkeyDialog();
      }, 100);
    }
  }
};

// 处理划词翻译触发方式选择变化
const handleSelectionTriggerChange = (value: string) => {
  config.value.selectionTranslatorHotkey = ['Control', 'Alt', 'Shift', 'custom'].includes(value) ? value : 'none';
  if (value === 'custom' && !config.value.customSelectionTranslatorHotkey) {
    setTimeout(() => {
      openCustomSelectionHotkeyDialog();
    }, 100);
  }
};

// 打开自定义划词翻译快捷键对话框
const openCustomSelectionHotkeyDialog = () => {
  showCustomSelectionHotkeyDialog.value = true;
};

// 确认自定义划词翻译快捷键
const handleCustomSelectionHotkeyConfirm = (hotkey: string) => {
  config.value.customSelectionTranslatorHotkey = hotkey;
  config.value.selectionTranslatorTrigger = 'custom';
  config.value.selectionTranslatorHotkey = 'custom';

  ElMessage({
    message: hotkey === 'none' ? '已禁用划词翻译快捷键' : `划词翻译快捷键已设置为: ${getCustomSelectionHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000,
  });
};

// 取消自定义划词翻译快捷键
const handleCustomSelectionHotkeyCancel = () => {
  if (!config.value.customSelectionTranslatorHotkey) {
    config.value.selectionTranslatorTrigger = 'icon';
    config.value.selectionTranslatorHotkey = 'none';
  }
};

// 获取自定义划词翻译快捷键显示名称
const getCustomSelectionHotkeyDisplayName = () => {
  if (!config.value.customSelectionTranslatorHotkey) return '';
  if (config.value.customSelectionTranslatorHotkey === 'none') return '已禁用';

  const parsed = parseHotkey(config.value.customSelectionTranslatorHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customSelectionTranslatorHotkey;
};

// 打开自定义鼠标悬浮快捷键对话框
const openCustomMouseHotkeyDialog = () => {
  showCustomMouseHotkeyDialog.value = true;
};

// 确认自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyConfirm = (hotkey: string) => {
  config.value.customHotkey = hotkey;
  config.value.hotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomMouseHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customHotkey) {
    config.value.hotkey = 'Control';
  }
};

const handleMouseHoverTranslationDelayChange = (value: number | undefined) => {
  config.value.mouseHoverTranslationDelay = normalizeMouseHoverTranslationDelay(value);
};

const handleSelectionTranslatorDelayChange = (value: number | undefined) => {
  config.value.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(value);
};

// 获取自定义鼠标悬浮快捷键显示名称
const getCustomMouseHotkeyDisplayName = () => {
  if (!config.value.customHotkey) return '';
  
  if (config.value.customHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customHotkey;
};

// 处理并发数量变化
const handleConcurrentChange = (currentValue: number | undefined) => {
  // 验证并发数量的有效性
  if (currentValue === undefined || currentValue < 1 || currentValue > 100) {
    ElMessage({
      message: '并发数量必须在 1-100 之间',
      type: 'warning',
      duration: 2000
    });
    // 恢复默认值
    config.value.maxConcurrentTranslations = 6;
    return;
  }
  
  ElMessage({
    message: `并发数量已更新为 ${currentValue}`,
    type: 'success',
    duration: 2000
  });
};

// Azure OpenAI 端点地址验证函数
const isValidAzureEndpoint = (endpoint: string) => {
  if (!endpoint || endpoint.trim() === '') {
    return false;
  }

  // 检查是否包含必要的组件
  const hasAzureDomain = endpoint.includes('openai.azure.com');
  const hasChatCompletions = endpoint.includes('/chat/completions');
  const hasHttps = endpoint.startsWith('https://');

  return hasHttps && hasAzureDomain && hasChatCompletions;
};

</script>

<style scoped src="./settings-sections.css"></style>
