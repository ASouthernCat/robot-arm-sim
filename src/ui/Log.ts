export interface LogMessage {
  id: string
  timestamp: Date
  type: 'info' | 'success' | 'warning' | 'error' | 'debug'
  content: string
  data?: any
}

class Log {
  private container!: HTMLElement
  private panel!: HTMLElement
  private toggleBtn!: HTMLElement
  private messagesContainer!: HTMLElement
  private scrollToBottomBtn!: HTMLElement
  private isExpanded: boolean = false
  private messages: LogMessage[] = []
  private maxMessages: number = 100
  private static instance: Log | null = null

  constructor() {
    this.createElements()
    this.bindEvents()
    this.setCollapsedState()
    this.renderMessageDomThread()
  }

  public static getInstance(): Log {
    if (!Log.instance) {
      Log.instance = new Log()
    }
    return Log.instance
  }

  public static destroyInstance(): void {
    if (Log.instance) {
      Log.instance.container.remove()
      Log.instance = null
    }
  }

  private createElements(): void {
    // 主容器
    this.container = document.createElement('div')
    this.container.className = 'log-display'
    document.body.appendChild(this.container)

    // 切换按钮（圆环）
    this.toggleBtn = document.createElement('div')
    this.toggleBtn.className = 'log-toggle'
    this.toggleBtn.innerHTML = `
      <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <!-- 轴承外圈 -->
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1"/>
        <!-- 轴承内圈 -->
        <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="1"/>
        <!-- 滚珠 -->
        <circle cx="12" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="17.2" cy="8.8" r="1.5" fill="currentColor"/>
        <circle cx="17.2" cy="15.2" r="1.5" fill="currentColor"/>
        <circle cx="12" cy="18" r="1.5" fill="currentColor"/>
        <circle cx="6.8" cy="15.2" r="1.5" fill="currentColor"/>
        <circle cx="6.8" cy="8.8" r="1.5" fill="currentColor"/>
        <!-- 轴承中心 -->
        <circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1"/>
      </svg>
    `

    // 日志面板
    this.panel = document.createElement('div')
    this.panel.className = 'log-panel'

    // 面板头部
    const header = document.createElement('div')
    header.className = 'log-header'
    header.innerHTML = `
      <div class="log-title">系统日志</div>
      <div class="header-actions">
        <button class="action-btn clear-btn" title="清空日志">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
          </svg>
        </button>
        <button class="action-btn collapse-btn" title="收起">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="11" width="12" height="2" rx="1" />
          </svg>
        </button>
      </div>
    `

    // 日志内容区域
    const content = document.createElement('div')
    content.className = 'log-content'
    this.messagesContainer = document.createElement('div')
    this.messagesContainer.className = 'log-messages'

    // 回到最新消息按钮
    this.scrollToBottomBtn = document.createElement('button')
    this.scrollToBottomBtn.className = 'scroll-to-bottom-btn hidden'
    this.scrollToBottomBtn.innerHTML = `
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" width="28" height="28" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;">
        <line x1="24" y1="10" x2="24" y2="32"/>
        <polyline points="16 28 24 36 32 28"/>
      </svg>
    `

    // 空状态
    const emptyState = document.createElement('div')
    emptyState.className = 'log-empty'
    emptyState.innerHTML = `
      <div class="empty-text">暂无日志信息</div>
    `

    this.messagesContainer.appendChild(emptyState)
    content.appendChild(this.messagesContainer)
    content.appendChild(this.scrollToBottomBtn)
    this.panel.appendChild(header)
    this.panel.appendChild(content)

    this.container.appendChild(this.panel)
    this.container.appendChild(this.toggleBtn)
  }

  private bindEvents(): void {
    // 切换按钮点击事件
    this.toggleBtn.addEventListener('click', () => {
      this.toggle()
    })

    // 折叠按钮点击事件
    const collapseBtn = this.panel.querySelector('.collapse-btn')
    collapseBtn?.addEventListener('click', () => {
      this.collapse()
    })

    // 清空按钮点击事件
    const clearBtn = this.panel.querySelector('.clear-btn')
    clearBtn?.addEventListener('click', () => {
      this.clear()
    })

    // 回到最新消息按钮点击事件
    this.scrollToBottomBtn.addEventListener('click', () => {
      this.scrollToBottom()
    })

    // 消息容器滚动事件
    this.messagesContainer.addEventListener('scroll', () => {
      this.handleScroll()
    })

    // ESC键折叠面板
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isExpanded) {
        this.collapse()
      }
    })
  }

  private toggle(): void {
    if (this.isExpanded) {
      this.collapse()
    } else {
      this.expand()
    }
  }

  private expand(): void {
    this.isExpanded = true
    this.container.className = 'log-display expanded'
  }

  private collapse(): void {
    this.isExpanded = false
    this.container.className = 'log-display collapsed'
  }

  private setCollapsedState(): void {
    this.container.className = 'log-display collapsed'
  }

  // 公共接口方法
  public log(type: LogMessage['type'], content: string, data?: any): void {
    const message: LogMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      type,
      content,
      data,
    }

    this.messages.push(message)
    if (this.messages.length > this.maxMessages) {
      this.messages.shift()
    }

    // TODO: 自动滚动到最新消息
  }

  public info(content: string, data?: any): void {
    this.log('info', content, data)
  }

  public success(content: string, data?: any): void {
    this.log('success', content, data)
  }

  public warning(content: string, data?: any): void {
    this.log('warning', content, data)
  }

  public error(content: string, data?: any): void {
    this.log('error', content, data)
  }

  public debug(content: string, data?: any): void {
    this.log('debug', content, data)
  }

  public clear(): void {
    this.messages = []
    this.messagesContainer.innerHTML = ''
    this.renderEmptyState()
    this.warning('日志已清空')
  }

  public getMessages(): LogMessage[] {
    return [...this.messages]
  }

  // 渲染日志消息dom线程
  private renderMessageDomThread() {
    const render = () => {
      requestAnimationFrame(() => {
        if (!this.isExpanded) {
          return render()
        }
        const message = this.messages.shift()
        if (message) {
          // 移除空状态
          const emptyState = this.messagesContainer.querySelector('.log-empty')
          if (emptyState) {
            emptyState.remove()
          }
          if (this.messagesContainer.children.length > this.maxMessages) {
            const oldMessage = this.messagesContainer.querySelector('.log-message')
            if (oldMessage) {
              oldMessage.remove()
            }
          }
          const messageElement = document.createElement('div')
          messageElement.className = 'log-message'
          messageElement.innerHTML = `
            <span class="message-time">${this.formatTime(message.timestamp)}</span>
            <span class="message-content ${message.type}">${message.content}</span>
            `
          this.messagesContainer.appendChild(messageElement)
          this.scrollToBottom()
        }
        render()
      })
    }
    render()
  }

  private renderEmptyState(): void {
    const emptyState = document.createElement('div')
    emptyState.className = 'log-empty'
    emptyState.innerHTML = `
      <div class="empty-text">暂无日志信息</div>
    `

    this.messagesContainer.appendChild(emptyState)
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  private handleScroll(): void {
    requestAnimationFrame(() => {
      this.checkScrollPosition()
    })
  }

  private checkScrollPosition(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    const isNearBottom = Math.abs(distanceFromBottom) < 200

    if (isNearBottom) {
      this.hideScrollToBottomButton()
    } else {
      this.showScrollToBottomButton()
    }
  }

  private showScrollToBottomButton(): void {
    this.scrollToBottomBtn.classList.remove('hidden')
  }

  private hideScrollToBottomButton(): void {
    this.scrollToBottomBtn.classList.add('hidden')
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight
    })
  }
}

export default Log.getInstance()
export const log = Log.getInstance()
