const METADATA_BASE = 'http://metadata.google.internal/computeMetadata/v1';
const COMPUTE_API_BASE = 'https://compute.googleapis.com/compute/v1';

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedProjectId = null;

async function fetchMetadata(relativePath, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${METADATA_BASE}/${relativePath}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Metadata ${relativePath} returned ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) {
    return cachedToken;
  }

  const raw = await fetchMetadata('instance/service-accounts/default/token');
  const parsed = JSON.parse(raw);
  cachedToken = parsed.access_token;
  cachedTokenExpiry = Date.now() + (parsed.expires_in || 300) * 1000;
  return cachedToken;
}

export async function getProjectId(configuredProject = '') {
  if (configuredProject) return configuredProject;
  if (cachedProjectId) return cachedProjectId;

  cachedProjectId = (await fetchMetadata('project/project-id')).trim();
  return cachedProjectId;
}

export function createGcpVmController({
  project = '',
  zone = '',
  vmName = '',
  staticHost = '',
  staticUrl = '',
  vmPort = 4000,
}) {
  const vmControlEnabled = Boolean(zone && vmName);

  async function computeRequest(endpointPath, method = 'GET') {
    const [token, resolvedProject] = await Promise.all([
      getAccessToken(),
      getProjectId(project),
    ]);
    const url = `${COMPUTE_API_BASE}/projects/${encodeURIComponent(resolvedProject)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(vmName)}${endpointPath}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || `Compute Engine API ${method} failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function buildBackendBaseUrl(externalIp) {
    if (staticUrl) return staticUrl.replace(/\/+$/, '');
    const host = externalIp || staticHost;
    if (!host) return null;
    if (host.startsWith('http://') || host.startsWith('https://')) {
      return host.replace(/\/+$/, '');
    }
    return `http://${host}:${vmPort}`;
  }

  async function getVmStatus() {
    if (!vmControlEnabled) {
      const backendUrl = buildBackendBaseUrl(null);
      return {
        configured: false,
        vmName: vmName || null,
        zone: zone || null,
        vmStatus: backendUrl ? 'RUNNING' : 'UNCONFIGURED',
        externalIp: staticHost || null,
        backendUrl,
      };
    }

    const instance = await computeRequest('');
    const externalIp =
      instance?.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || staticHost || null;

    return {
      configured: true,
      vmName,
      zone,
      vmStatus: instance?.status || 'UNKNOWN',
      externalIp,
      backendUrl: buildBackendBaseUrl(externalIp),
    };
  }

  async function startVm() {
    if (!vmControlEnabled) {
      return getVmStatus();
    }

    const current = await getVmStatus();
    if (
      current.vmStatus === 'TERMINATED' ||
      current.vmStatus === 'STOPPED' ||
      current.vmStatus === 'SUSPENDED'
    ) {
      await computeRequest('/start', 'POST');
      return {
        ...current,
        vmStatus: 'PROVISIONING',
      };
    }
    return current;
  }

  async function stopVm() {
    if (!vmControlEnabled) {
      throw new Error('GCP_ZONE and GPU_VM_NAME must be configured to stop the GPU VM.');
    }

    const current = await getVmStatus();
    if (current.vmStatus === 'RUNNING') {
      await computeRequest('/stop', 'POST');
      return {
        ...current,
        vmStatus: 'STOPPING',
      };
    }
    return current;
  }

  async function probeBackendHealth(backendUrl, timeoutMs = 3000) {
    if (!backendUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${backendUrl}/api/health`, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureVmReady({ timeoutMs = 150_000, pollIntervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let startTriggered = false;

    while (Date.now() < deadline) {
      const state = await getVmStatus();

      if (
        vmControlEnabled &&
        !startTriggered &&
        (state.vmStatus === 'TERMINATED' ||
          state.vmStatus === 'STOPPED' ||
          state.vmStatus === 'SUSPENDED')
      ) {
        await startVm();
        startTriggered = true;
      }

      if (state.vmStatus === 'RUNNING' && state.backendUrl) {
        const health = await probeBackendHealth(state.backendUrl, 3000);
        if (health) {
          return { ...state, health, ready: true };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const lastState = await getVmStatus().catch(() => ({ vmStatus: 'UNKNOWN' }));
    const err = new Error(
      `GPU VM "${vmName || staticHost || 'worker'}" did not become ready within ${Math.round(timeoutMs / 1000)}s (last status: ${lastState.vmStatus}).`
    );
    err.code = 'VM_WAKE_TIMEOUT';
    throw err;
  }

  return {
    vmControlEnabled,
    getVmStatus,
    startVm,
    stopVm,
    probeBackendHealth,
    ensureVmReady,
  };
}
