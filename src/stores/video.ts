import axios from "@/utils/axios";
import { ref, computed, watch, nextTick } from "vue";

// 图片项
export interface ImageItem {
  id: number;
  filePath: string;
  prompt: string;
}

// 视频配置 - 用户创建的配置
export interface VideoConfig {
  id: number;
  scriptId: number;
  projectId: number;
  model: string;
  aiConfigId: number | undefined;
  manufacturer: string;
  mode: "startEnd" | "multi" | "single" | "text";
  startFrame: ImageItem | null;
  endFrame: ImageItem | null;
  images: ImageItem[];
  resolution: string;
  duration: number;
  prompt: string;
  selectedResultId: number | null; // 选中的生成结果ID
  createdAt: string;
  audioEnabled: boolean;
  dialogue?: string;
  audioPath?: string;
  ttsAudioPath?: string;
  sort?: number | null;
  voiceConfigId?: number | null;
  voicePresetId?: string;
  audioTrack?: number | null;
  dialogueTrack?: number | null;
}

// 视频生成结果
export interface VideoResult {
  id: number;
  scriptId: number;
  configId: number; // 关联的配置ID
  state: 0 | 1 | -1; // 生成中/成功/失败
  filePath: string;
  firstFrame: string;
  duration: number;
  prompt: string;
  createdAt: string;
  errorReason?: string;
}

type VideoResultPayload = Partial<VideoResult> & {
  id?: number;
  scriptId?: number;
  configId?: number;
  state?: 0 | 1 | -1;
  filePath?: string;
  firstFrame?: string;
  duration?: number;
  time?: number;
  prompt?: string;
  createdAt?: string;
  errorReason?: string;
};

type VideoConfigPayload = Partial<VideoConfig> & {
  id?: number;
  scriptId?: number;
  projectId?: number;
};

function toPayloadArray<T extends object>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is T => typeof item === "object" && item !== null);
}

export default defineStore(
  "video",
  () => {
    // 配置列表
    const videoConfigs = ref<VideoConfig[]>([]);
    // 生成结果列表
    const videoResults = ref<VideoResult[]>([]);
    // 当前脚本ID
    const currentScriptId = ref<number | null>(null);
    // 当前项目ID
    const currentProjectId = ref<number | null>(null);
    // 轮询定时器
    let pollingTimer: number | null = null;
    // 配置ID计数器
    let configIdCounter = 0;

    // 获取当前脚本的配置列表
    const currentConfigs = computed(() => {
      if (!currentScriptId.value) return [];
      return videoConfigs.value.filter((c) => c.scriptId === currentScriptId.value);
    });

    // 获取待轮询的结果ID列表（state === 0）
    const pendingResultIds = computed(() => {
      return videoResults.value.filter((r) => r.state === 0).map((r) => r.id);
    });

    // 根据配置ID获取其所有生成结果
    function getResultsByConfigId(configId: number): VideoResult[] {
      return videoResults.value.filter((r) => r.configId === configId);
    }

    // 获取配置的选中结果
    function getSelectedResult(configId: number): VideoResult | null {
      const config = videoConfigs.value.find((c) => c.id === configId);
      if (!config || !config.selectedResultId) return null;
      const selectedResultId = Number(config.selectedResultId);
      if (!Number.isFinite(selectedResultId) || selectedResultId <= 0) return null;
      return videoResults.value.find((r) => Number(r.id) === selectedResultId) || null;
    }

    // 设置当前脚本ID并加载数据
    async function setCurrentScript(scriptId: number, projectId: number) {
      currentScriptId.value = scriptId;
      currentProjectId.value = projectId;
      // 同时获取视频配置和视频生成结果
      await Promise.all([fetchVideoConfigs(scriptId), fetchVideoData(scriptId)]);
    }

    // 从后端获取视频数据（视频生成结果）
    async function fetchVideoData(scriptId: number, specifyIds: number[] = []) {
      try {
        const reqBodyObj = {
          scriptId: scriptId,
          specifyIds: specifyIds,
        };
        const { data } = await axios.post("/video/getVideo", reqBodyObj);
        const payloadList = toPayloadArray<VideoResultPayload>(data);

        if (specifyIds.length > 0) {
          // 部分更新：只更新指定ID的结果状态
          if (payloadList.length === 0) return;
          // 创建新数组以触发响应式更新
          const updatedResults = videoResults.value.map((r) => {
            const updated = payloadList.find((item) => Number(item.id) === r.id);
            if (updated) {
              return {
                ...r,
                scriptId: updated.scriptId || r.scriptId,
                state: updated.state,
                filePath: updated.filePath || r.filePath,
                firstFrame: updated.firstFrame || r.firstFrame,
                duration: updated.duration || r.duration,
                errorReason: updated.errorReason || r.errorReason,
              };
            }
            return r;
          });
          videoResults.value = updatedResults;
        } else {
          // 全量更新：解析后端数据，转换为结果列表
          // 只处理视频结果，不再重建配置（配置从 fetchVideoConfigs 获取）
          parseVideoResults(payloadList, scriptId);
        }
      } catch (error) {
        console.error("获取视频数据失败:", error);
      }
    }

    async function refreshRemoteStatus(scriptId: number, specifyIds: number[] = []) {
      if (!scriptId) {
        throw new Error("无效的剧本ID");
      }
      if (!Array.isArray(specifyIds) || specifyIds.length === 0) {
        throw new Error("没有可刷新的生成任务");
      }

      const res = await axios.post("/video/refreshVideoStatus", {
        scriptId,
        specifyIds,
      });
      await fetchVideoData(scriptId, specifyIds);
      return res?.data?.data || {};
    }

    // 解析后端视频数据为结果列表（不再重建配置）
    function parseVideoResults(data: VideoResultPayload[], scriptId: number) {
      // 全量刷新时，直接替换当前脚本的结果，避免草稿负ID被重复追加
      const newResults: VideoResult[] = data.map((item) => ({
        id: Number(item.id || 0),
        scriptId: item.scriptId || scriptId,
        configId: item.configId || 0, // 后端应该返回 configId
        state: Number(item.state || 0) as 0 | 1 | -1,
        filePath: item.filePath || "",
        firstFrame: item.firstFrame || "",
        duration: item.duration || item.time || 0,
        prompt: item.prompt || "",
        createdAt: item.createdAt || new Date().toISOString(),
        errorReason: item.errorReason || "",
      }));

      // 去重并排序
      const dedupMap = new Map<number, VideoResult>();
      newResults.forEach((item) => dedupMap.set(item.id, item));
      const merged = [...videoResults.value.filter((r) => r.scriptId !== scriptId), ...Array.from(dedupMap.values())];
      merged.sort((a, b) => a.id - b.id);
      videoResults.value = merged;
    }

    // 从后端获取视频配置列表
    async function fetchVideoConfigs(scriptId: number) {
      try {
        const { data } = await axios.post("/video/getVideoConfigs", { scriptId });
        const payloadList = toPayloadArray<VideoConfigPayload>(data);
        const parsedConfigs: VideoConfig[] = payloadList.map((item) => ({
          id: Number(item.id || 0),
          scriptId: Number(item.scriptId || scriptId),
          projectId: Number(item.projectId || currentProjectId.value || 0),
          model: item.model || "",
          aiConfigId: item.aiConfigId,
          manufacturer: item.manufacturer || "",
          mode: (item.mode || "startEnd") as VideoConfig["mode"],
          startFrame: item.startFrame || null,
          endFrame: item.endFrame || null,
          images: item.images || [],
          resolution: item.resolution || "",
          duration: Number(item.duration || 0),
          prompt: item.prompt || "",
          selectedResultId: Number.isFinite(Number(item.selectedResultId)) ? Number(item.selectedResultId) : null,
          createdAt: item.createdAt || new Date().toISOString(),
          audioEnabled: Boolean(item.audioEnabled),
          dialogue: item.dialogue || "",
          audioPath: item.audioPath || "",
          ttsAudioPath: item.ttsAudioPath || "",
          sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : null,
          voiceConfigId: Number.isFinite(Number(item.voiceConfigId)) ? Number(item.voiceConfigId) : null,
          voicePresetId: item.voicePresetId || "",
          audioTrack: Number.isFinite(Number(item.audioTrack)) ? Number(item.audioTrack) : 1,
          dialogueTrack: Number.isFinite(Number(item.dialogueTrack)) ? Number(item.dialogueTrack) : 1,
        }));

        // 仅替换当前脚本的数据，避免误清空其它脚本缓存
        const others = videoConfigs.value.filter((item) => item.scriptId !== scriptId);
        videoConfigs.value = [...others, ...parsedConfigs];

        const maxId = parsedConfigs.reduce((max, item) => Math.max(max, item.id), configIdCounter);
        configIdCounter = Math.max(configIdCounter, maxId);
      } catch (error) {
        console.error("获取视频配置失败:", error);
      }
    }

    // 从后端返回的数据添加配置（用于新增配置后）
    function addConfigFromBackend(configData: VideoConfigPayload): VideoConfig {
      const newConfig: VideoConfig = {
        id: Number(configData.id || 0),
        scriptId: Number(configData.scriptId || 0),
        projectId: Number(configData.projectId || 0),
        model: configData.model || "",
        aiConfigId: configData.aiConfigId,
        manufacturer: configData.manufacturer || "",
        mode: (configData.mode || "startEnd") as VideoConfig["mode"],
        startFrame: configData.startFrame || null,
        endFrame: configData.endFrame || null,
        images: configData.images || [],
        resolution: configData.resolution || "",
        duration: Number(configData.duration || 0),
        prompt: configData.prompt || "",
        selectedResultId: Number.isFinite(Number(configData.selectedResultId)) ? Number(configData.selectedResultId) : null,
        createdAt: configData.createdAt || new Date().toISOString(),
        audioEnabled: configData.audioEnabled,
        dialogue: configData.dialogue || "",
        audioPath: configData.audioPath || "",
        ttsAudioPath: configData.ttsAudioPath || "",
        sort: Number.isFinite(Number(configData.sort)) ? Number(configData.sort) : null,
        voiceConfigId: Number.isFinite(Number(configData.voiceConfigId)) ? Number(configData.voiceConfigId) : null,
        voicePresetId: configData.voicePresetId || "",
        audioTrack: Number.isFinite(Number(configData.audioTrack)) ? Number(configData.audioTrack) : 1,
        dialogueTrack: Number.isFinite(Number(configData.dialogueTrack)) ? Number(configData.dialogueTrack) : 1,
      };
      videoConfigs.value.unshift(newConfig);

      // 更新configIdCounter
      if (newConfig.id > configIdCounter) {
        configIdCounter = newConfig.id;
      }

      return newConfig;
    }

    // 添加新配置（本地，仅用于临时操作）
    function addConfig(configData: Omit<VideoConfig, "id" | "createdAt" | "selectedResultId">): VideoConfig {
      const newConfig: VideoConfig = {
        ...configData,
        // 确保图片字段有默认值
        startFrame: configData.startFrame || null,
        endFrame: configData.endFrame || null,
        images: configData.images || [],
        id: ++configIdCounter,
        selectedResultId: null,
        createdAt: new Date().toISOString(),
      };
      videoConfigs.value.push(newConfig);
      return newConfig;
    }

    // 删除配置（支持单个和批量）
    async function removeConfig(configId: number | number[]) {
      const ids = Array.isArray(configId) ? configId : [configId];
      if (ids.length === 0) return;

      try {
        await axios.post("/video/deleteVideoConfig", ids.length === 1 ? { id: ids[0] } : { ids });
      } catch (error) {
        // 某些后端版本只支持单个删除，批量时降级逐个删除
        if (ids.length > 1) {
          try {
            await Promise.all(ids.map((id) => axios.post("/video/deleteVideoConfig", { id })));
          } catch (batchError) {
            console.error("删除配置失败:", batchError);
            throw batchError;
          }
        } else {
          console.error("删除配置失败:", error);
          throw error;
        }
      }

      // 删除本地 store 中的数据
      videoConfigs.value = videoConfigs.value.filter((c) => !ids.includes(c.id));
      // 同时删除关联的结果
      videoResults.value = videoResults.value.filter((r) => !ids.includes(r.configId));
    }

    // 生成视频（单个配置）
    async function generateVideo(configId: number): Promise<void> {
      const config = videoConfigs.value.find((c) => c.id === configId);

      if (!config) {
        throw new Error("配置不存在");
      }

      const pending = getResultsByConfigId(configId).find((r) => r.state === 0);
      if (pending) {
        throw new Error("当前配置已有生成中的任务，请先等待或点击“刷新状态”");
      }

      // 构建图片路径列表
      const videoImgs: string[] = [];
      if (config.mode === "startEnd") {
        if (config.startFrame) videoImgs.push(config.startFrame.filePath);
        if (config.endFrame) videoImgs.push(config.endFrame.filePath);
      } else if (config.mode === "single") {
        if (config.startFrame) videoImgs.push(config.startFrame.filePath);
      } else if (config.mode == "text") {
        videoImgs.length = 0;
      } else {
        config.images.forEach((img) => videoImgs.push(img.filePath));
      }
      // 调用后端接口
      const { data } = await axios.post("/video/generateVideo", {
        projectId: config.projectId,
        scriptId: config.scriptId,
        mode: config.mode,
        aiConfigId: config.aiConfigId,
        configId: configId, // 关联配置ID
        resolution: config.resolution,
        filePath: videoImgs,
        duration: config.duration,
        prompt: config.prompt,
        audioEnabled: config.audioEnabled,
      });

      // 添加新的结果到列表（使用后端返回的真实 ID）
      if (data && data.id) {
        const existing = videoResults.value.find((r) => r.id === data.id);
        if (existing) {
          existing.scriptId = config.scriptId;
          existing.configId = configId;
          existing.state = 0;
          existing.duration = config.duration;
          existing.prompt = config.prompt;
        } else {
          const newResult: VideoResult = {
            id: data.id,
            scriptId: config.scriptId,
            configId: configId,
            state: 0, // 生成中
            filePath: "",
            firstFrame: "",
            duration: config.duration,
            prompt: config.prompt,
            createdAt: new Date().toISOString(),
          };
          // 使用展开运算符创建新数组，确保触发响应式更新
          videoResults.value = [...videoResults.value, newResult];
        }

        // 立刻拉一次状态，避免用户感觉“点击无效”
        await fetchVideoData(config.scriptId, [data.id]);
        // 任务写入远端存在延迟，补两次短延迟刷新
        setTimeout(() => {
          void fetchVideoData(config.scriptId, [data.id]);
        }, 1200);
        setTimeout(() => {
          void fetchVideoData(config.scriptId, [data.id]);
        }, 3000);

        // 强制开始轮询，确保新添加的结果能被轮询到
        startPolling(true);
      }
    }

    // 选择一个结果作为最终选择
    function selectResult(configId: number, resultId: number) {
      const config = videoConfigs.value.find((c) => c.id === configId);
      if (config) {
        config.selectedResultId = resultId;
      }
    }

    // 更新配置（仅基础字段）
    function updateConfig(configId: number, updates: Partial<Pick<VideoConfig, "prompt" | "resolution" | "duration">>) {
      const config = videoConfigs.value.find((c) => c.id === configId);
      if (config) {
        if (updates.prompt !== undefined) config.prompt = updates.prompt;
        if (updates.resolution !== undefined) config.resolution = updates.resolution;
        if (updates.duration !== undefined) config.duration = updates.duration;
      }
    }

    // 更新配置（包括图片字段）
    function updateConfigFull(
      configId: number,
      updates: Partial<
        Pick<
          VideoConfig,
          | "prompt"
          | "resolution"
          | "duration"
          | "startFrame"
          | "endFrame"
          | "images"
          | "mode"
          | "audioEnabled"
          | "aiConfigId"
          | "manufacturer"
          | "model"
        >
      >,
    ) {
      const config = videoConfigs.value.find((c) => c.id === configId);
      if (config) {
        if (updates.aiConfigId !== undefined) config.aiConfigId = updates.aiConfigId;
        if (updates.manufacturer !== undefined) config.manufacturer = updates.manufacturer;
        if (updates.model !== undefined) config.model = updates.model;
        if (updates.prompt !== undefined) config.prompt = updates.prompt;
        if (updates.resolution !== undefined) config.resolution = updates.resolution;
        if (updates.duration !== undefined) config.duration = updates.duration;
        if (updates.startFrame !== undefined) config.startFrame = updates.startFrame;
        if (updates.endFrame !== undefined) config.endFrame = updates.endFrame;
        if (updates.images !== undefined) config.images = [...updates.images];
        if (updates.mode !== undefined) config.mode = updates.mode;
        if (updates.audioEnabled !== undefined) config.audioEnabled = updates.audioEnabled;
      }
    }

    // 开始轮询
    function startPolling(force: boolean = false) {
      if (pollingTimer) {
        // 如果已有定时器且不是强制启动，直接返回
        if (!force) return;
        // 强制启动时，先停止旧的定时器
        stopPolling();
      }

      // 使用 nextTick 确保 computed 属性已更新
      nextTick(() => {
        if (pendingResultIds.value.length === 0) return;

        pollingTimer = window.setInterval(async () => {
          if (pendingResultIds.value.length === 0) {
            stopPolling();
            return;
          }
          if (currentScriptId.value) {
            await fetchVideoData(currentScriptId.value, pendingResultIds.value);
          }
        }, 4000);
      });
    }

    // 停止轮询
    function stopPolling() {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    }

    // 监听待处理结果变化，自动开始/停止轮询
    watch(pendingResultIds, (newVal) => {
      if (newVal.length > 0) {
        startPolling();
      } else {
        stopPolling();
      }
    });

    // 清理
    function cleanup() {
      stopPolling();
    }

    return {
      // 状态
      videoConfigs,
      videoResults,
      currentScriptId,
      currentProjectId,
      currentConfigs,
      pendingResultIds,
      // 方法
      setCurrentScript,
      fetchVideoData,
      refreshRemoteStatus,
      fetchVideoConfigs,
      addConfig,
      addConfigFromBackend,
      removeConfig,
      updateConfig,
      updateConfigFull,
      generateVideo,
      selectResult,
      getResultsByConfigId,
      getSelectedResult,
      startPolling,
      stopPolling,
      cleanup,
    };
  },
  { persist: false },
);
