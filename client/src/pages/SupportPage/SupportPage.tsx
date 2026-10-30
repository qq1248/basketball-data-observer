import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Send,
  Plus,
  MessageCircle,
  AlertCircle,
  Headphones,
  X,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useAuth } from '@client/src/hooks/useAuth';
import AuthModal from '@client/src/components/AuthModal';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Badge } from '@client/src/components/ui/badge';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@client/src/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  supportApi,
} from '@client/src/api';
import { toast } from 'sonner';
import type {
  SupportTicketListItem,
  SupportTicketWithMessages,
  SupportMessage,
  CreateSupportTicketRequest,
} from '@shared/api.interface';

const FAQS: { q: string; a: string }[] = [
  {
    q: '数据多久更新一次？',
    a: '足球/篮球比赛数据每日定时更新，比赛进行中会根据实时比分源动态刷新，一般延迟 1-3 分钟。',
  },
  {
    q: '模型输出概率/信心度口径？',
    a: '模型输出概率基于历史数据、球队状态、伤病情报等多维度模型计算得出，仅供参考。信心度表示模型对该输出的把握程度，越高代表模型越确信。',
  },
  {
    q: '如何收藏与关注比赛？',
    a: '在比赛详情页点击收藏按钮即可收藏，收藏的比赛会在个人中心展示，方便快速查看。',
  },
  {
    q: '账号登录与密码问题？',
    a: '本应用使用平台统一账号体系，登录/注册/密码找回请通过平台提供的入口操作。',
  },
  {
    q: '数据/比分延迟说明？',
    a: '实时比分依赖第三方数据源，可能存在 1-5 分钟延迟，最终结果以官方公布为准。',
  },
  {
    q: '合规声明',
     a: '本应用仅提供体育赛事数据统计与模型概率分析，内容不构成任何决策建议。请理性看待体育赛事，理性观赛，遵守相关法律法规。',
  },
];

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  processing: '处理中',
  closed: '已关闭',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700 border border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border border-blue-200',
  closed: 'bg-gray-50 text-gray-500 border border-gray-200',
};

const CATEGORIES: CreateSupportTicketRequest['category'][] = [
  '功能问题',
  '数据问题',
  '建议反馈',
  '其他',
];

const formatTime = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  } catch {
    return '';
  }
};

const SupportPage = () => {
  const navigate = useNavigate();
  const { user: selfUser, loading: authLoading, fetchMe } = useAuth();
  const isLoggedIn = !!selfUser;
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [tickets, setTickets] = useState<SupportTicketListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<SupportTicketWithMessages | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [inputText, setInputText] = useState('');
  const [sendLoading, setSendLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '',
    category: '功能问题' as CreateSupportTicketRequest['category'],
    email: '',
    body: '',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    if (!isLoggedIn) return;
    setListLoading(true);
    setListError(null);
    try {
      const res = await supportApi.getMyTickets();
      setTickets(res.items);
    } catch (err) {
      logger.error('加载工单列表失败', err);
      setListError('网络异常，请稍后重试');
    } finally {
      setListLoading(false);
    }
  }, [isLoggedIn]);

  const loadTicketDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      let detail = await supportApi.getTicket(id);
      if (detail?.messages?.length === 0 && detail.lastMessageAt) {
        logger.info(`工单 ${id} 首次返回空消息但 lastMessageAt 存在，重试拉取`);
        detail = await supportApi.getTicket(id);
      }
      setTicketDetail(detail);
    } catch (err) {
      logger.error(`加载工单详情失败: ${id}`, err);
      setDetailError('网络异常，请稍后重试');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      void loadTickets();
    } else {
      setTickets([]);
      setSelectedId(null);
      setTicketDetail(null);
    }
  }, [isLoggedIn, loadTickets]);

  useEffect(() => {
    if (selectedId && isLoggedIn) {
      void loadTicketDetail(selectedId);
    }
  }, [selectedId, isLoggedIn]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticketDetail?.messages]);

  const handleSelectTicket = (id: string) => {
    setSelectedId(id);
  };

  const handleBackToList = () => {
    setSelectedId(null);
    setTicketDetail(null);
    setDetailError(null);
  };

  const handleSendMessage = async () => {
    if (!selectedId || !inputText.trim() || sendLoading) return;
    const body = inputText.trim();
    if (body.length > 5000) {
      toast.error('消息内容不能超过5000个字符');
      return;
    }
    setSendLoading(true);
    try {
      const msg: SupportMessage = await supportApi.sendMessage(selectedId, body);
      setInputText('');
      if (ticketDetail) {
        setTicketDetail({
          ...ticketDetail,
          messages: [...ticketDetail.messages, msg],
        });
      }
      void loadTickets();
    } catch (err) {
      logger.error('发送消息失败', err);
      let message = '发送失败，请稍后重试';
      const respData = (err as { response?: { data?: { error?: { message?: string; details?: string } } } })?.response?.data;
      const errInfo = respData?.error;
      if (errInfo?.details) {
        try {
          const detailObj = JSON.parse(errInfo.details) as { message?: string | string[] };
          if (detailObj.message) {
            message = Array.isArray(detailObj.message)
              ? detailObj.message.join('；')
              : detailObj.message;
          }
        } catch {
          if (errInfo.message) message = errInfo.message;
        }
      } else if (errInfo?.message && errInfo.message !== 'Bad Request Exception') {
        message = errInfo.message;
      }
      toast.error(message);
    } finally {
      setSendLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleCreateTicket = async () => {
    const title = createForm.title.trim();
    const body = createForm.body.trim();
    const email = createForm.email.trim();

    if (!title) {
      toast.error('请输入标题');
      return;
    }
    if (title.length < 2) {
      toast.error('标题至少需要2个字符');
      return;
    }
    if (title.length > 255) {
      toast.error('标题不能超过255个字符');
      return;
    }
    if (!body) {
      toast.error('请输入问题描述');
      return;
    }
    if (body.length > 5000) {
      toast.error('问题描述不能超过5000个字符');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('请输入有效的邮箱地址');
      return;
    }

    setCreateLoading(true);
    try {
      const newTicket = await supportApi.createTicket({
        title,
        category: createForm.category,
        email: email || undefined,
        body,
      });
      toast.success('工单已提交，我们会尽快回复');
      setCreateOpen(false);
      setCreateForm({ title: '', category: '功能问题', email: '', body: '' });
      setTickets((prev) => [newTicket as SupportTicketListItem, ...prev]);
      setSelectedId(newTicket.id);
    } catch (err) {
      logger.error('创建工单失败', err);
      let message = '提交失败，请稍后重试';
      const respData = (err as { response?: { data?: { error?: { message?: string; details?: string; code?: string }; message?: string | string[] } } })?.response?.data;
      const errInfo = respData?.error;
      if (errInfo?.details) {
        try {
          const detailObj = JSON.parse(errInfo.details) as { message?: string | string[] };
          if (detailObj.message) {
            message = Array.isArray(detailObj.message)
              ? detailObj.message.join('；')
              : detailObj.message;
          } else if (errInfo.message && errInfo.message !== 'Bad Request Exception') {
            message = errInfo.message;
          }
        } catch {
          if (errInfo.message && errInfo.message !== 'Bad Request Exception') {
            message = errInfo.message;
          }
        }
      } else if (errInfo?.message && errInfo.message !== 'Bad Request Exception') {
        message = errInfo.message;
      } else if (respData?.message) {
        message = Array.isArray(respData.message)
          ? respData.message.join('；')
          : respData.message;
      }
      toast.error(message);
    } finally {
      setCreateLoading(false);
    }
  };

  // ---- 未登录提示 ----
  const renderLoginPrompt = () => (
    <div className="metric-card p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-nebula-crimson/10 flex items-center justify-center mx-auto mb-4">
        <Headphones className="w-7 h-7 text-nebula-crimson" />
      </div>
      <h3 className="text-base font-black tracking-tight text-foreground mb-1">
        请先登录后再提交反馈
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        登录后即可查看历史工单并与我们实时沟通
      </p>
      <Button onClick={() => setAuthModalOpen(true)}>前往登录</Button>
    </div>
  );

  // ---- FAQ ----
  const renderFaq = () => (
    <div className="metric-card overflow-hidden mb-4">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
          <AlertCircle className="w-4 h-4 text-nebula-crimson" />
        </div>
        <h2 className="text-base font-black tracking-tight text-foreground">常见问题</h2>
      </div>
      <Accordion type="single" collapsible className="px-3 py-1">
        {FAQS.map((faq, idx) => (
          <AccordionItem key={idx} value={`faq-${idx}`} className="px-2">
            <AccordionTrigger className="text-sm font-medium text-foreground">
              {faq.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
              {faq.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );

  // ---- 工单列表 ----
  const renderTicketList = () => {
    if (listLoading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="metric-card p-4 animate-pulse"
            >
              <div className="h-4 w-2/3 bg-muted rounded mb-2" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          ))}
        </div>
      );
    }

    if (listError) {
      return (
        <div className="metric-card p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">{listError}</p>
          <Button variant="secondary" size="sm" onClick={() => loadTickets()}>
            重试
          </Button>
        </div>
      );
    }

    if (tickets.length === 0) {
      return (
        <div className="metric-card p-8 text-center">
          <MessageCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-4">
            暂无工单，点击下方按钮发起反馈
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            发起新工单
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {tickets.map((ticket) => (
          <button
            key={ticket.id}
            onClick={() => handleSelectTicket(ticket.id)}
            className="w-full text-left metric-card p-4 hover:shadow-md transition-all duration-300"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3 className="text-sm font-medium text-foreground line-clamp-1 flex-1">
                {ticket.title}
              </h3>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {ticket.unreadByUser > 0 && (
                  <span className="w-2 h-2 rounded-full bg-nebula-crimson flex-shrink-0" />
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[ticket.status]}`}
                >
                  {STATUS_LABEL[ticket.status]}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-[10px] py-0 h-4">
                {ticket.category}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatTime(ticket.createdAt)}
              </span>
            </div>
            {ticket.latestMessagePreview && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {ticket.latestMessagePreview}
              </p>
            )}
          </button>
        ))}
      </div>
    );
  };

  // ---- 会话详情 ----
  const renderTicketDetail = () => {
    if (detailLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      );
    }

    if (detailError || !ticketDetail) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <p className="text-sm text-muted-foreground mb-3">
            {detailError || '加载失败'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => selectedId && loadTicketDetail(selectedId)}
          >
            重试
          </Button>
        </div>
      );
    }

    const isClosed = ticketDetail.status === 'closed';

    return (
      <>
        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {ticketDetail.messages.length === 0 && (
            <div className="text-center py-8">
              <MessageCircle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                暂无消息，在下方输入框发送第一条消息吧
              </p>
            </div>
          )}
          {ticketDetail.messages.map((msg: SupportMessage) => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-nebula-crimson text-white rounded-br-md'
                      : 'bg-muted text-foreground rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  <p
                    className={`text-[10px] mt-1 ${
                      isUser ? 'text-white/60' : 'text-muted-foreground'
                    }`}
                  >
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="border-t border-border p-3 bg-card">
          {isClosed ? (
            <div className="text-center py-2">
              <p className="text-xs text-muted-foreground">
                工单已关闭，如需继续反馈请发起新工单
              </p>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Input
                value={inputText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setInputText(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder="输入消息，回车发送"
                className="flex-1"
              />
              <Button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || sendLoading}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-10 bg-card/80 backdrop-blur border-b border-border px-4 h-12 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 -ml-2"
          onClick={() => {
            if (selectedId) {
              handleBackToList();
            } else {
              navigate(-1);
            }
          }}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-base font-black tracking-tight text-foreground flex-1 truncate">
          {selectedId && ticketDetail
            ? ticketDetail.title
             : '帮助与反馈'}
        </h1>
        {selectedId && ticketDetail && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[ticketDetail.status]}`}
          >
            {STATUS_LABEL[ticketDetail.status]}
          </span>
        )}
        {!selectedId && isLoggedIn && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="h-8"
          >
            <Plus className="w-4 h-4 mr-1" />
            新工单
          </Button>
        )}
      </div>

      <div className="p-4 pb-6">
        {/* 详情页：只显示会话 */}
        {selectedId ? (
          <div className="metric-card overflow-hidden flex flex-col h-[calc(100vh-7rem)]">
            {renderTicketDetail()}
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="mb-5">
              <div className="eyebrow eyebrow-line mb-2">SUPPORT CENTER</div>
              <h1 className="text-3xl font-black tracking-tight text-foreground mb-1">
                帮助与反馈
              </h1>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                 常见问题解答与工单反馈
              </p>
            </div>

            {renderFaq()}

            {!isLoggedIn ? (
              renderLoginPrompt()
            ) : (
              <>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-base font-black tracking-tight text-foreground">
                    我的工单
                  </h2>
                  {isLoggedIn && tickets.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCreateOpen(true)}
                      className="h-7"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      发起新工单
                    </Button>
                  )}
                </div>
                {renderTicketList()}
              </>
            )}
          </>
        )}
      </div>

      {/* 新建工单弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>发起新工单</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mr-2 -mt-1"
                onClick={() => setCreateOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                标题 <span className="text-red-500">*</span>
              </label>
              <Input
                value={createForm.title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateForm({ ...createForm, title: e.target.value })
                }
                placeholder="请简要描述您的问题"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                类别
              </label>
              <Select
                value={createForm.category}
                onValueChange={(val) =>
                  setCreateForm({
                    ...createForm,
                    category: val as CreateSupportTicketRequest['category'],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                联系邮箱（选填）
              </label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateForm({ ...createForm, email: e.target.value })
                }
                placeholder="方便我们通过邮件回复您"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                问题描述 <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={createForm.body}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setCreateForm({ ...createForm, body: e.target.value })
                }
                placeholder="请详细描述您遇到的问题或建议..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(false)}
              disabled={createLoading}
            >
              取消
            </Button>
            <Button onClick={() => handleCreateTicket()} disabled={createLoading}>
              {createLoading ? '提交中...' : '提交工单'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        onSuccess={() => {
          setAuthModalOpen(false);
          void fetchMe();
        }}
      />
    </div>
  );
};

export default SupportPage;
