# ChatLab 智能协作 - UI 设计文档

> 状态：UI 线框设计  
> 日期：2026-04-09  
> 风格：保持现有群聊分析页面设计风格（pink-500 active、深色主题、SubTabs、SectionCard）

---

## 页面结构总览

5 个新 Tab 将在群聊/私聊页面的主 Tab 列表中添加（基于现有 OverviewTab、ViewTab、QuotesTab、MemberTab、ChatExplorer、AITab 的导航模式）。

```
┌─────────────────────────────────────────────────────────────────────┐
│ 【群聊名称】                          [聊天记录] [截图]              │
├─────────────────────────────────────────────────────────────────────┤
│ [概览] [视图] [引用] [成员] [任务] [待办] [知识库] [图谱] [关注] [AI] │
└─────────────────────────────────────────────────────────────────────┘
                         新增的 5 个 Tab ^^
```

---

## Tab 1：任务管理（Task Tab）

### 导航面板

```
┌─────────────────────────────────────────────────────────────────┐
│ 任务管理（跨会话）           [+ 新建任务] [🔄 重新提取]           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 来源：[全部 ▼] │ 状态：[全部 ▼] │ 排序：[截止时间 ▼]            │
│                                                                 │
│ 信息：15 个任务 │ 待处理 5 │ 进行中 3 │ 已完成 7                │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔴 完成用户模块开发                            [进行中]         │
│     责任人：小明  │  截止：2024-01-20                          │
│     来源：#产品讨论组 (3条消息)  │  参与者：老王, 李经理         │
│     AI置信度：95%  [✏️编辑] [↗️查看] [✓完成]                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  🟡 准备周会材料                              [待处理]          │
│     责任人：设计师小张  │  截止：2024-01-22                    │
│     来源：#工作群 (1条消息)                                     │
│     AI置信度：88%  [✏️编辑] [↗️查看]                          │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  ✅ 修复登录Bug                                [已完成]         │
│     责任人：老王  │  完成于：2024-01-18                        │
│     来源：#技术群 (2条消息)                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 页面布局

```html
<template>
  <div class="flex h-full flex-col p-6 bg-white dark:bg-gray-900">
    <!-- Header -->
    <div class="mb-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
          任务管理（跨会话）
        </h1>
        <div class="flex gap-2">
          <UButton size="sm" color="primary" icon="i-heroicons-plus">
            新建任务
          </UButton>
          <UButton size="sm" variant="soft" icon="i-heroicons-arrow-path">
            重新提取
          </UButton>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="mb-4 flex gap-4 items-center pb-4 border-b border-gray-200 dark:border-gray-700">
      <div class="flex gap-2">
        <span class="text-sm font-medium text-gray-600 dark:text-gray-400">来源：</span>
        <USelectMenu v-model="filterSource" :options="sourceOptions" placeholder="全部" />
      </div>
      <div class="flex gap-2">
        <span class="text-sm font-medium text-gray-600 dark:text-gray-400">状态：</span>
        <USelectMenu v-model="filterStatus" :options="statusOptions" placeholder="全部" />
      </div>
      <div class="flex gap-2">
        <span class="text-sm font-medium text-gray-600 dark:text-gray-400">排序：</span>
        <USelectMenu v-model="sortBy" :options="sortOptions" placeholder="截止时间" />
      </div>
    </div>

    <!-- Stats -->
    <div class="mb-4 text-sm text-gray-600 dark:text-gray-400">
      信息：<span class="font-semibold">{{ totalTasks }}</span> 个任务 │
      待处理 <span class="font-semibold text-amber-500">{{ pendingCount }}</span> │
      进行中 <span class="font-semibold text-blue-500">{{ inProgressCount }}</span> │
      已完成 <span class="font-semibold text-green-500">{{ completedCount }}</span>
    </div>

    <!-- Task List -->
    <div class="flex-1 overflow-y-auto space-y-3">
      <div v-for="task in filteredTasks" :key="task.id"
           class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 
                  bg-white dark:bg-gray-800 hover:shadow-md transition-shadow">
        <!-- Status Badge + Title -->
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <span :class="getStatusBadgeClass(task.status)" class="text-2xl">
              {{ getStatusEmoji(task.status) }}
            </span>
            <h3 class="font-semibold text-gray-900 dark:text-white">{{ task.title }}</h3>
          </div>
          <UBadge :color="getStatusColor(task.status)">
            {{ getStatusLabel(task.status) }}
          </UBadge>
        </div>

        <!-- Metadata -->
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-2 space-y-1">
          <div>责任人：{{ task.owner }}  │  截止：{{ formatDate(task.dueDate) }}</div>
          <div>来源：{{ task.source }}  │  参与者：{{ task.participants.join(', ') }}</div>
        </div>

        <!-- Confidence + Actions -->
        <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
          <span class="text-xs text-gray-500 dark:text-gray-500">
            AI置信度：<span class="font-semibold">{{ task.confidence }}%</span>
          </span>
          <div class="flex gap-1">
            <UButton size="xs" color="gray" variant="ghost" icon="i-heroicons-pencil">
              编辑
            </UButton>
            <UButton size="xs" color="gray" variant="ghost" icon="i-heroicons-arrow-top-right-on-square">
              查看
            </UButton>
            <UButton v-if="task.status !== 'completed'" size="xs" color="green" variant="ghost" icon="i-heroicons-check">
              完成
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## Tab 2：待办清单（Todo Tab）

### 页面概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 我的待办                                    [+ 新建待办]         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 状态：[全部 ▼] │ 优先级：[全部 ▼] │ 标签：[#工作 ▼] [更多...]    │
│ 排序：[截止时间 ▼]                                              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 待处理（3）                                                    │
│ ┌─────────────────────────────────────────────────────────────┐
│ │ ☐ 修复登录页面搜索框问题                                     │
│ │   来自任务：【产品组】修复用户模块登录问题                   │
│ │   截止：明天 10:00  │  标签：#bugs  │  [✎编辑] [✓完成]      │
│ └─────────────────────────────────────────────────────────────┘
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐
│ │ ☐ 制作API文档                                               │
│ │   来自任务：准备周会材料  │  优先级：⭐⭐⭐                  │
│ │   截止：2024-01-22  │  标签：#文档  │  [✎编辑] [✓完成]      │
│ └─────────────────────────────────────────────────────────────┘
│                                                                 │
│ 进行中（1）                                                    │
│ ┌─────────────────────────────────────────────────────────────┐
│ │ ⊙ 推进微服务架构设计                                        │
│ │   手动创建  │  优先级：⭐⭐                                 │
│ │   进度：50%  │  [✎编辑] [⏸暂停] [✓完成]                    │
│ └─────────────────────────────────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 关键功能

- **自动同步**：从 Task Tab 自动生成个人待办
- **手动创建**：支持创建与聊天无关的个人待办
- **进度跟踪**：进行中的待办可展示进度条
- **多状态分组**：待处理、进行中、已完成分组显示
- **来源识别**：标识待办是来自任务还是手动创建

---

## Tab 3：关注点管理（Focus Tab）

### 页面概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 我的关注                                      [+ 手动关注]       │
├─────────────────────────────────────────────────────────────────┐
│                                                                 │
│ 类型：[全部 ▼] │ 状态：[活跃 ▼] │ 按热度排序                     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ⭐ 微服务架构改造                      最后活动：2小时前        │
│    类型：话题 (Topic)  │  涉及会话：3个  │  提及：12次           │
│    关键词：[微服务] [架构] [Redis]                             │
│    最新进展：小明提出新的分层设计  │  [查看动态] [取消关注]    │
│                                                                 │
│ ─────────────────────────────────────────────────────────────  │
│                                                                 │
│ ⭐ 张三（人物）                        最后活动：1小时前        │
│    类型：人物 (Person)  │  涉及会话：2个  │  总提及：45次        │
│    标签：[技术负责人] [产品经理]                               │
│    最近行动：提出新功能需求                 │  [查看提及] [...]  │
│                                                                 │
│ ─────────────────────────────────────────────────────────────  │
│                                                                 │
│ ⭐ API 接口重构（项目）                 最后活动：3小时前      │
│    类型：项目 (Project)  │  涉及会话：4个  │  提及：8次          │
│    关键词：[重构] [性能] [兼容性]                              │
│    进度：设计阶段  │  负责人：老王           │  [查看详情] [...]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 自动识别vs手动关注

- **自动识别**：系统检测用户频繁提及或参与讨论的话题，自动创建关注
- **手动关注**：用户点击消息右键"添加到关注"或手动输入话题/人物名称

---

## Tab 4：知识库（Knowledge Tab）

### 页面概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 知识库（跨会话）                    [+ 新建知识] [搜索...]       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 类型：[FAQ ▼] │ 分类：[全部 ▼] │ 排序：[浏览数 ▼]              │
│ 标签：[#新手入门] [#API] [#故障排查] [更多...]                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ FAQ（12个）                                                    │
│                                                                 │
│ 1. 如何快速开始使用 API？                                      │
│    分类：API 入门  │  来源：#技术群 (3)  │  浏览：234  │  点赞：18 │
│    答案摘要：首先需要申请 API Key...                          │
│    AI 置信度：98%  │  已编辑  [编辑] [删除] [展开]              │
│                                                                 │
│ ─────────────────────────────────────────────────────────────  │
│                                                                 │
│ 2. 微信通知频繁掉线怎么处理？                                   │
│    分类：故障排查  │  来源：#用户反馈 (2), #技术群 (1)           │
│    答案摘要：通常是网络连接问题，可以尝试...                   │
│    AI 置信度：92%  │  未编辑  [编辑] [删除] [展开]              │
│                                                                 │
│ ─────────────────────────────────────────────────────────────  │
│                                                                 │
│ 概念（8个）                                                    │
│                                                                 │
│ 3. 什么是微服务架构？                                          │
│    分类：基础概念  │  来源：#架构讨论 (5)  │  浏览：467         │
│    内容摘要：微服务架构是一种...                              │
│    AI 置信度：95%  │  已编辑  [编辑] [删除] [展开]              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 子 Tab 结构（使用 SubTabs）

```
[📚 FAQ] [💡 概念] [📖 文档] [🔧 流程] [💬 Q&A]
```

---

## Tab 5：知识图谱（Graph Tab）

### 页面概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 知识图谱（跨会话）        [全屏] [导出] [重新构建] [帮助]       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 时间范围：[2024-01-01] ═══════●════════●════ [2024-01-31]    │
│           └──────────────── 拖动左右调整时间窗口 ─────────┘   │
│                                                                 │
│ 类型过滤：[☑ Person] [☑ Task] [☑ Event] [☐ Concept]          │
│          [☐ System] [☐ Module] [更多...]                     │
│          [✕ 清除全部] [✓ 全选]                              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    【知识图谱可视化区域】                       │
│                                                                 │
│                      ┌─────────┐                              │
│                      │ 小明    │  👤 Person (核心)            │
│                      │(技术PM) │                              │
│                      └────┬────┘                              │
│          ┌───────────────┼───────────────┐                    │
│          │               │               │                    │
│     ┌────▼────┐   ┌────▼────┐   ┌────▼────┐               │
│     │ 用户模块 │   │微服务架构│   │ API文档 │               │
│     │(Module) │   │(Concept)│   │(Artifact)               │
│     │  ◀LLM▶  │   │  ◀LLM▶  │   │  核心   │               │
│     └────┬────┘   └────────┘   └────────┘               │
│          │ CALLS                                       │
│     ┌────▼────┐                                      │
│     │支付系统  │                                     │
│     │(System) │ ──MENTIONS──▶ [更多...]              │
│     │  ◀LLM▶  │                                      │
│     └────────┘                                      │
│                                                      │
├─────────────────────────────────────────────────────────────────┤
│ 统计：节点 156  │ 边 234  │ 会话覆盖 5  │ 时间跨度 30天        │
│ 图例：👤 Person  📋 Task  📅 Event  📍 Location  📄 Artifact   │
│      ⬡ 动态实体（LLM扩展）                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 交互特性

- **时间轴过滤**：拖动时间轴实时显示/隐藏节点
- **节点点击**：展开邻近节点（展开 1 跳邻接关系）
- **节点固定**：可固定重要节点避免被力导向布局移动
- **全屏模式**：展开为全屏可视化
- **导出**：支持导出为 GraphML / JSON 格式

---

## 设计规范与继承

### 颜色方案

| 元素 | 颜色 | 说明 |
|------|------|------|
| Active Tab | `pink-500` | 与现有群聊 Tab 风格一致 |
| Primary Button | `primary-600` / `primary-500` | UButton 默认色 |
| Status Badge（待处理） | `amber-500` | 黄色警示 |
| Status Badge（进行中） | `blue-500` | 蓝色进行 |
| Status Badge（完成） | `green-500` | 绿色成功 |
| Border | `gray-200` / `gray-700`(dark) | 浅边框 |
| Text | `gray-900` / `white`(dark) | 高对比 |

### 组件继承

- **PageHeader**：用于每个 Tab 的标题区（现有）
- **SubTabs**：知识库内的类型切换，Focus 的排序切换
- **SectionCard**：知识卡片、任务卡片容器
- **UButton**：统一按钮样式
- **UBadge**：状态/标签显示
- **USelectMenu**：下拉筛选器

### 排版规范

- **标题字号**：`text-2xl` (h1)、`text-lg` (h2)、`text-base` (h3)
- **正文**：`text-sm` 灰度文本、`text-xs` 辅助文本
- **间距**：`gap-4` 主区域、`gap-2` 内部项、`p-6` 容器 padding
- **圆角**：`rounded-lg` 卡片、`rounded-xl` 大组件
- **阴影**：`shadow-sm` 浮动卡片（hover）、`shadow-lg` 模态框

### 深色主题

所有 Tab 都应遵循现有的深色主题设计：

```
Dark Mode Colors:
- bg: gray-900 / gray-800
- text: white / gray-300
- border: white/5 / gray-700
```

---

## 集成入现有页面

在 `src/pages/group-chat/index.vue` 中添加新 Tab 定义：

```typescript
const allTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'quotes', labelKey: 'analysis.tabs.groupQuotes', icon: 'i-heroicons-chat-bubble-bottom-center-text' },
  { id: 'members', labelKey: 'analysis.tabs.members', icon: 'i-heroicons-user-group' },
  // 新增 5 个 Tab
  { id: 'tasks', labelKey: 'analysis.tabs.tasks', icon: 'i-heroicons-clipboard-document-check' },
  { id: 'todos', labelKey: 'analysis.tabs.todos', icon: 'i-heroicons-list-bullet' },
  { id: 'focus', labelKey: 'analysis.tabs.focus', icon: 'i-heroicons-star' },
  { id: 'knowledge', labelKey: 'analysis.tabs.knowledge', icon: 'i-heroicons-book-open' },
  { id: 'graph', labelKey: 'analysis.tabs.graph', icon: 'i-heroicons-network-icon' },
  // 原有 Tab
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]
```

在 template 中添加条件渲染：

```vue
<TaskTab v-else-if="activeTab === 'tasks'" :key="`tasks-${currentSessionId}`" :session-id="currentSessionId!" :time-filter="timeFilter" />
<TodoTab v-else-if="activeTab === 'todos'" :key="`todos-${currentSessionId}`" :session-id="currentSessionId!" :time-filter="timeFilter" />
<FocusTab v-else-if="activeTab === 'focus'" :key="`focus-${currentSessionId}`" :session-id="currentSessionId!" :time-filter="timeFilter" />
<KnowledgeTab v-else-if="activeTab === 'knowledge'" :key="`knowledge-${currentSessionId}`" :session-id="currentSessionId!" :time-filter="timeFilter" />
<GraphTab v-else-if="activeTab === 'graph'" :key="`graph-${currentSessionId}`" :session-id="currentSessionId!" :time-filter="timeFilter" />
```

---

**文档结束** | UI 设计已完成，准备开发

