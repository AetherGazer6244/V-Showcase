import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import StatsView from './StatsView.vue';
import { OWNER_KEY_STORAGE } from './stats';

/* ============================================================
 * StatsView 组件级测试
 *   重点:锁的三种状态(没密码 / 密码错 / 密码对)与渲染内容
 * ============================================================ */

const PAYLOAD = {
  status: true,
  data: {
    totals: { pv: 120, uv: 45, today: { pv: 7, uv: 3 } },
    daily: [
      { day: '2026-11-01', pv: 10, uv: 4 },
      { day: '2026-11-02', pv: 20, uv: 9 },
    ],
    likes: [
      { url: 'https://img/a.jpg', count: 7 },
      { url: 'https://img/b.jpg', count: 2 },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StatsView 未解锁', () => {
  it('没存过站长密码 → 显示密码输入框,不发请求', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(PAYLOAD));
    const wrapper = mount(StatsView);
    await flushPromises();

    expect(wrapper.find('.stats-lock').exists()).toBe(true);
    expect(wrapper.find('.stats-lock-input').exists()).toBe(true);
    expect(wrapper.find('.stats-cards').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('密码错 → 报错、不解锁、并清掉本机存的密码', async () => {
    mockFetch(async () => jsonResponse({ status: false, message: '站长密码不正确' }, 401));
    const wrapper = mount(StatsView);
    await flushPromises();

    await wrapper.find('.stats-lock-input').setValue('wrong');
    await wrapper.find('.stats-lock-form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.stats-lock-msg').text()).toContain('站长密码不正确');
    expect(wrapper.find('.stats-lock').exists()).toBe(true);
    expect(sessionStorage.getItem(OWNER_KEY_STORAGE)).toBeNull();
    wrapper.unmount();
  });

  it('服务端没配 OWNER_PASSWORD(503) → 把原因显示出来', async () => {
    mockFetch(async () => jsonResponse({ status: false, message: '未配置站长密码(OWNER_PASSWORD)' }, 503));
    const wrapper = mount(StatsView);
    await flushPromises();

    await wrapper.find('.stats-lock-input').setValue('x');
    await wrapper.find('.stats-lock-form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.stats-lock-msg').text()).toContain('OWNER_PASSWORD');
    wrapper.unmount();
  });
});

describe('StatsView 解锁后', () => {
  it('密码对 → 渲染概览 / 趋势图 / 点赞排行 / 明细表', async () => {
    mockFetch(async () => jsonResponse(PAYLOAD));
    const wrapper = mount(StatsView);
    await flushPromises();

    await wrapper.find('.stats-lock-input').setValue('owner-pw');
    await wrapper.find('.stats-lock-form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.stats-lock').exists()).toBe(false);
    expect(wrapper.findAll('.stats-card')).toHaveLength(4);
    expect(wrapper.text()).toContain('120');   // 总访问
    expect(wrapper.text()).toContain('45');    // 总访客
    expect(wrapper.find('.stats-chart-svg').exists()).toBe(true);
    expect(wrapper.findAll('.stats-bar')).toHaveLength(4);   // 2 天 × 2 根柱
    expect(wrapper.findAll('.stats-like')).toHaveLength(2);
    expect(wrapper.findAll('.stats-table tbody tr')).toHaveLength(2);
    wrapper.unmount();
  });

  it('密码存进 sessionStorage(关标签页即失效)', async () => {
    mockFetch(async () => jsonResponse(PAYLOAD));
    const wrapper = mount(StatsView);
    await flushPromises();

    await wrapper.find('.stats-lock-input').setValue('owner-pw');
    await wrapper.find('.stats-lock-form').trigger('submit');
    await flushPromises();

    expect(sessionStorage.getItem(OWNER_KEY_STORAGE)).toBe('owner-pw');
    wrapper.unmount();
  });

  it('已存密码 → 打开即自动取数,不再要输密码', async () => {
    sessionStorage.setItem(OWNER_KEY_STORAGE, 'saved-pw');
    const fetchMock = mockFetch(async () => jsonResponse(PAYLOAD));
    const wrapper = mount(StatsView);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.stats-lock').exists()).toBe(false);
    expect(wrapper.find('.stats-cards').exists()).toBe(true);
    wrapper.unmount();
  });

  it('已存密码失效(401) → 回到密码框', async () => {
    sessionStorage.setItem(OWNER_KEY_STORAGE, 'stale-pw');
    mockFetch(async () => jsonResponse({ status: false, message: '站长密码不正确' }, 401));
    const wrapper = mount(StatsView);
    await flushPromises();

    expect(wrapper.find('.stats-lock').exists()).toBe(true);
    expect(sessionStorage.getItem(OWNER_KEY_STORAGE)).toBeNull();
    wrapper.unmount();
  });

  it('「退出」清掉本机密码并回到密码框', async () => {
    sessionStorage.setItem(OWNER_KEY_STORAGE, 'saved-pw');
    mockFetch(async () => jsonResponse(PAYLOAD));
    const wrapper = mount(StatsView);
    await flushPromises();

    const exitBtn = wrapper.findAll('button').find((b) => b.text() === '退出');
    expect(exitBtn).toBeTruthy();
    await exitBtn!.trigger('click');
    await flushPromises();

    expect(wrapper.find('.stats-lock').exists()).toBe(true);
    expect(sessionStorage.getItem(OWNER_KEY_STORAGE)).toBeNull();
    wrapper.unmount();
  });
});
