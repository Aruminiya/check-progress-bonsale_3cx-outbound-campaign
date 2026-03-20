import axios from 'axios';

function getInstance() {
  return axios.create({
    baseURL: process.env.BONSLAE_3CX_OUTBOUND_CAMPAIGN_HOST,
  });
}

export function startAutoDial(project) {
  return getInstance().post(`/api/outbound/start`, {
    callFlowId: project.callFlowId,
    projectId: project.projectId,
    client_id: project.appId,
    client_secret: project.appSecret,
    recurrence: project.recurrence || null,
    callRestriction: project.callRestriction || [],
  });
}

export function stopAutoDial(projectId) {
  return getInstance().post(`/api/outbound/stop`, { projectId });
}