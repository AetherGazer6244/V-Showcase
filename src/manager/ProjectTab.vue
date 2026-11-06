<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  loadProjects, saveProjects, syncDeploy, toast,
  type MProject,
} from './api';

/* 项目写作台:卡片式编辑,保存写 content/projects.json。 */

const projects = ref<MProject[]>([]);
const loading = ref(false);
const dirty = ref(false);
const deploying = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const data = await loadProjects();
    projects.value = data ?? [];
  } finally {
    loading.value = false;
  }
});

function addProject() {
  projects.value.push({ name: '', desc: '', status: 'wip', tech: [], year: String(new Date().getFullYear()) });
  dirty.value = true;
}

function removeProject(i: number) {
  projects.value.splice(i, 1);
  dirty.value = true;
}

function markDirty() { dirty.value = true; }

/** tech 在表单里用逗号分隔字符串编辑,保存时切回数组 */
function techText(p: MProject): string {
  return p.tech.join(', ');
}
function setTech(p: MProject, text: string) {
  p.tech = text.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  markDirty();
}

async function onSave() {
  if (!(await saveProjects(projects.value))) return;
  dirty.value = false;
  toast(`项目已保存(${projects.value.length} 个),部署后生效`, 'success');
}

async function onSaveDeploy() {
  deploying.value = true;
  try {
    if (!(await saveProjects(projects.value))) return;
    dirty.value = false;
    const msg = await syncDeploy('content/projects.json');
    if (msg) toast('项目已推送,Cloudflare 将自动构建', 'success');
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="projecttab">
    <div class="pt-bar">
      <button class="btn" type="button" @click="addProject">+ 新项目</button>
      <span class="pt-bar-gap"></span>
      <button class="btn" type="button" :disabled="loading" @click="onSave">💾 保存</button>
      <button class="btn btn-primary" type="button" :disabled="loading || deploying" @click="onSaveDeploy">
        {{ deploying ? '推送中…' : '🚀 保存并部署' }}
      </button>
    </div>

    <div v-if="loading" class="pt-empty">加载中…</div>
    <div v-else-if="projects.length === 0" class="pt-empty">还没有项目 — 点击上方按钮添加</div>

    <div v-else class="pt-grid">
      <article v-for="(p, i) in projects" :key="i" class="pt-card">
        <div class="pt-card-head">
          <input v-model="p.name" class="input pt-name" placeholder="项目名" @input="markDirty">
          <select v-model="p.status" class="input pt-status" aria-label="状态" @change="markDirty">
            <option value="active">维护中</option>
            <option value="wip">进行中</option>
            <option value="archived">已归档</option>
          </select>
          <button class="icon-btn icon-btn-danger" type="button" title="删除" @click="removeProject(i)">✕</button>
        </div>
        <textarea v-model="p.desc" class="input pt-desc" rows="3" placeholder="一句话介绍" @input="markDirty"></textarea>
        <div class="pt-row">
          <label class="pt-field">
            <span>技术栈(逗号分隔)</span>
            <input class="input" :value="techText(p)" @input="setTech(p, ($event.target as HTMLInputElement).value)">
          </label>
          <label class="pt-field pt-field-sm">
            <span>年份</span>
            <input v-model="p.year" class="input" placeholder="2026" @input="markDirty">
          </label>
        </div>
        <div class="pt-row">
          <label class="pt-field">
            <span>演示地址</span>
            <input v-model="p.link" class="input" placeholder="https://(可选)" @input="markDirty">
          </label>
          <label class="pt-field">
            <span>仓库地址</span>
            <input v-model="p.repo" class="input" placeholder="https://github.com/…(可选)" @input="markDirty">
          </label>
        </div>
      </article>
    </div>

    <p v-if="dirty" class="pt-dirty">● 有未保存改动</p>
  </div>
</template>
