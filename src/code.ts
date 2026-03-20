// ============================================================
// FiVot Plugin - Main Code (runs in Figma sandbox)
// ============================================================

// Worker API base URL
const DEFAULT_API_BASE = 'https://figma-vote.manuna530.workers.dev';
const API_BASE = figma.root.getPluginData('api_base') || DEFAULT_API_BASE;

interface VoteOption {
  id: string;
  label: string;
  nodeId?: string;
  imageData?: string;
}

interface VoteSession {
  id: string;
  title: string;
  description: string;
  type: 'poll' | 'design' | 'reaction';
  options: VoteOption[];
  createdBy: string;
  createdAt: number;
  status: 'active' | 'closed';
  shareUrl?: string;
}

// --- Helpers ---

function currentUser() {
  return {
    id: figma.currentUser ? figma.currentUser.id : null,
    name: figma.currentUser ? figma.currentUser.name : 'Anonymous',
  };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Local Storage (fallback when no API) ---

function getLocalSessions(): VoteSession[] {
  const raw = figma.root.getPluginData('vote_sessions');
  return raw ? JSON.parse(raw) : [];
}

function saveLocalSessions(sessions: VoteSession[]): void {
  figma.root.setPluginData('vote_sessions', JSON.stringify(sessions));
}

function getLocalVotes(): any[] {
  const raw = figma.root.getPluginData('vote_records');
  return raw ? JSON.parse(raw) : [];
}

function saveLocalVotes(votes: any[]): void {
  figma.root.setPluginData('vote_records', JSON.stringify(votes));
}

// --- API Helpers ---

async function apiRequest(path: string, method: string, body?: any): Promise<any> {
  if (!API_BASE) return null;

  try {
    const options: any = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(API_BASE + path, options);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'API error');
    }
    return await res.json();
  } catch (e) {
    console.error('API request failed:', e);
    return null;
  }
}

// --- Export frame thumbnails ---

async function exportNodeThumbnail(nodeId: string): Promise<string | null> {
  try {
    const node = figma.getNodeById(nodeId);
    if (!node || !('exportAsync' in node)) return null;
    const bytes = await (node as SceneNode).exportAsync({
      format: 'PNG',
      constraint: { type: 'WIDTH', value: 300 },
    });
    return 'data:image/png;base64,' + figma.base64Encode(bytes);
  } catch (e) {
    return null;
  }
}

// --- Message Handling ---

figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; payload?: any }) => {
  const { type, payload } = msg;

  try {
  switch (type) {

    // ---- Settings ----
    case 'set-api-base': {
      figma.root.setPluginData('api_base', payload.url);
      figma.notify('API URL이 설정되었습니다: ' + payload.url);
      figma.ui.postMessage({ type: 'api-base-set', payload: { url: payload.url } });
      break;
    }

    case 'get-api-base': {
      const url = figma.root.getPluginData('api_base') || '';
      figma.ui.postMessage({ type: 'api-base-value', payload: { url } });
      break;
    }

    // ---- Sessions ----
    case 'get-sessions': {
      // Local sessions
      const localSessions = getLocalSessions();
      const localVotes = getLocalVotes();
      const list = localSessions.map(function(s) {
        return Object.assign({}, s, {
          totalVotes: localVotes.filter(function(v: any) { return v.sessionId === s.id; }).length,
        });
      });
      figma.ui.postMessage({ type: 'sessions-list', payload: list });
      break;
    }

    case 'get-session': {
      // Try API first
      if (API_BASE && payload.sessionId) {
        const apiData = await apiRequest('/api/sessions/' + payload.sessionId, 'GET');
        if (apiData && !apiData.error) {
          const user = currentUser();
          // Find user's vote
          var userVotedOptionId: string | null = null;
          var voterId = 'figma_' + (user.id || 'anon');
          // Check all options for user's vote
          for (var i = 0; i < apiData.options.length; i++) {
            var opt = apiData.options[i];
            if (opt.voters && opt.voters.indexOf(user.name) !== -1) {
              userVotedOptionId = opt.id;
            }
          }
          apiData.userVotedOptionId = userVotedOptionId;
          figma.ui.postMessage({ type: 'session-data', payload: apiData });
          break;
        }
      }

      // Fallback: local data
      var sessions = getLocalSessions();
      var session = sessions.find(function(s) { return s.id === payload.sessionId; });
      if (!session) {
        figma.ui.postMessage({ type: 'error', payload: '투표를 찾을 수 없습니다.' });
        break;
      }
      var allVotes = getLocalVotes().filter(function(v: any) { return v.sessionId === payload.sessionId; });
      var user2 = currentUser();
      var userVote = allVotes.find(function(v: any) { return v.userId === user2.id; });
      var results = session.options.map(function(o) {
        var optVotes = allVotes.filter(function(v: any) { return v.optionId === o.id; });
        return Object.assign({}, o, {
          voteCount: optVotes.length,
          voters: optVotes.map(function(v: any) { return v.userName; }),
        });
      });
      figma.ui.postMessage({
        type: 'session-data',
        payload: Object.assign({}, session, {
          options: results,
          totalVotes: allVotes.length,
          userVotedOptionId: userVote ? userVote.optionId : null,
        }),
      });
      break;
    }

    case 'create-session': {
      const { title, description, sessionType, options } = payload;
      const user = currentUser();

      // If API is configured, create on server
      if (API_BASE) {
        const apiResult = await apiRequest('/api/sessions', 'POST', {
          title,
          description,
          type: sessionType,
          options,
          createdBy: user.name,
        });
        if (apiResult && apiResult.session) {
          // Save reference locally
          const localSession: VoteSession = Object.assign({}, apiResult.session, {
            shareUrl: apiResult.shareUrl,
          });
          const sessions = getLocalSessions();
          sessions.unshift(localSession);
          saveLocalSessions(sessions);
          figma.ui.postMessage({ type: 'session-created', payload: localSession });
          figma.notify('투표가 생성되었습니다! 링크를 공유하세요.');
          break;
        }
      }

      // Fallback: local only
      const session: VoteSession = {
        id: generateId(),
        title,
        description: description || '',
        type: sessionType,
        options: options.map(function(opt: any) {
          return {
            id: generateId(),
            label: opt.label,
            nodeId: opt.nodeId,
            imageData: opt.imageData,
          };
        }),
        createdBy: user.name,
        createdAt: Date.now(),
        status: 'active',
      };
      const localSessions = getLocalSessions();
      localSessions.unshift(session);
      saveLocalSessions(localSessions);
      figma.ui.postMessage({ type: 'session-created', payload: session });
      figma.notify('투표 "' + title + '" 이(가) 생성되었습니다. (로컬 전용)');
      break;
    }

    case 'delete-session': {
      if (API_BASE) {
        await apiRequest('/api/sessions/' + payload.sessionId, 'DELETE');
      }
      var delSessions = getLocalSessions();
      delSessions = delSessions.filter(function(s) { return s.id !== payload.sessionId; });
      saveLocalSessions(delSessions);
      var delVotes = getLocalVotes();
      delVotes = delVotes.filter(function(v: any) { return v.sessionId !== payload.sessionId; });
      saveLocalVotes(delVotes);
      figma.ui.postMessage({ type: 'session-deleted' });
      figma.notify('투표가 삭제되었습니다.');
      break;
    }

    case 'close-session': {
      if (API_BASE) {
        await apiRequest('/api/sessions/' + payload.sessionId, 'PATCH', { status: 'closed' });
      }
      var closeSessions = getLocalSessions();
      var closeIdx = closeSessions.findIndex(function(s) { return s.id === payload.sessionId; });
      if (closeIdx !== -1) {
        closeSessions[closeIdx].status = 'closed';
        saveLocalSessions(closeSessions);
        figma.ui.postMessage({ type: 'session-closed', payload: closeSessions[closeIdx] });
        figma.notify('투표가 마감되었습니다.');
      }
      break;
    }

    case 'reopen-session': {
      if (API_BASE) {
        await apiRequest('/api/sessions/' + payload.sessionId, 'PATCH', { status: 'active' });
      }
      var reopenSessions = getLocalSessions();
      var reopenIdx = reopenSessions.findIndex(function(s) { return s.id === payload.sessionId; });
      if (reopenIdx !== -1) {
        reopenSessions[reopenIdx].status = 'active';
        saveLocalSessions(reopenSessions);
        figma.ui.postMessage({ type: 'session-reopened', payload: reopenSessions[reopenIdx] });
        figma.notify('투표가 다시 열렸습니다.');
      }
      break;
    }

    // ---- Voting ----
    case 'cast-vote': {
      const { sessionId, optionId } = payload;
      const user = currentUser();

      if (API_BASE) {
        const apiResult = await apiRequest('/api/sessions/' + sessionId + '/vote', 'POST', {
          optionId,
          voterId: 'figma_' + (user.id || 'anon'),
          voterName: user.name,
        });
        if (apiResult && !apiResult.error) {
          apiResult.userVotedOptionId = optionId;
          figma.ui.postMessage({ type: 'session-data', payload: apiResult });
          break;
        }
      }

      // Fallback: local
      var castSessions = getLocalSessions();
      var castSession = castSessions.find(function(s) { return s.id === sessionId; });
      if (!castSession) {
        figma.ui.postMessage({ type: 'error', payload: '투표를 찾을 수 없습니다.' });
        break;
      }
      if (castSession.status === 'closed') {
        figma.ui.postMessage({ type: 'error', payload: '이미 마감된 투표입니다.' });
        break;
      }
      var castVotes = getLocalVotes();
      castVotes = castVotes.filter(function(v: any) {
        return !(v.sessionId === sessionId && v.userId === user.id);
      });
      castVotes.push({
        sessionId: sessionId,
        optionId: optionId,
        userId: user.id,
        userName: user.name,
        timestamp: Date.now(),
      });
      saveLocalVotes(castVotes);
      // Reload session
      // Reload session data
      var reloadSessions = getLocalSessions();
      var reloadSession = reloadSessions.find(function(s) { return s.id === sessionId; });
      if (reloadSession) {
        var reloadVotes = getLocalVotes().filter(function(v: any) { return v.sessionId === sessionId; });
        var reloadUser = currentUser();
        var reloadUserVote = reloadVotes.find(function(v: any) { return v.userId === reloadUser.id; });
        var reloadResults = reloadSession.options.map(function(o) {
          var ov = reloadVotes.filter(function(v: any) { return v.optionId === o.id; });
          return Object.assign({}, o, { voteCount: ov.length, voters: ov.map(function(v: any) { return v.userName; }) });
        });
        figma.ui.postMessage({
          type: 'session-data',
          payload: Object.assign({}, reloadSession, {
            options: reloadResults,
            totalVotes: reloadVotes.length,
            userVotedOptionId: reloadUserVote ? reloadUserVote.optionId : null,
          }),
        });
      }
      break;
    }

    case 'remove-vote': {
      const { sessionId } = payload;
      const user = currentUser();

      if (API_BASE) {
        const apiResult = await apiRequest('/api/sessions/' + sessionId + '/vote', 'DELETE', {
          voterId: 'figma_' + (user.id || 'anon'),
        });
        if (apiResult) {
          apiResult.userVotedOptionId = null;
          figma.ui.postMessage({ type: 'session-data', payload: apiResult });
          break;
        }
      }

      var rmVotes = getLocalVotes();
      rmVotes = rmVotes.filter(function(v: any) {
        return !(v.sessionId === sessionId && v.userId === user.id);
      });
      saveLocalVotes(rmVotes);
      // Reload session data
      var reloadSessions = getLocalSessions();
      var reloadSession = reloadSessions.find(function(s) { return s.id === sessionId; });
      if (reloadSession) {
        var reloadVotes = getLocalVotes().filter(function(v: any) { return v.sessionId === sessionId; });
        var reloadUser = currentUser();
        var reloadUserVote = reloadVotes.find(function(v: any) { return v.userId === reloadUser.id; });
        var reloadResults = reloadSession.options.map(function(o) {
          var ov = reloadVotes.filter(function(v: any) { return v.optionId === o.id; });
          return Object.assign({}, o, { voteCount: ov.length, voters: ov.map(function(v: any) { return v.userName; }) });
        });
        figma.ui.postMessage({
          type: 'session-data',
          payload: Object.assign({}, reloadSession, {
            options: reloadResults,
            totalVotes: reloadVotes.length,
            userVotedOptionId: reloadUserVote ? reloadUserVote.optionId : null,
          }),
        });
      }
      break;
    }

    // ---- Frame Selection ----
    case 'get-selected-frames': {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({ type: 'selected-frames', payload: [] });
        figma.notify('프레임을 선택해주세요.', { timeout: 2000 });
        break;
      }

      const frames: { nodeId: string; label: string; imageData: string | null }[] = [];
      for (const node of selection) {
        const imageData = await exportNodeThumbnail(node.id);
        frames.push({ nodeId: node.id, label: node.name, imageData });
      }
      figma.ui.postMessage({ type: 'selected-frames', payload: frames });
      break;
    }

    case 'focus-node': {
      const node = figma.getNodeById(payload.nodeId);
      if (node && 'x' in node) {
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
      }
      break;
    }

    case 'get-current-user': {
      figma.ui.postMessage({ type: 'current-user', payload: currentUser() });
      break;
    }

    case 'reset-all': {
      figma.root.setPluginData('vote_sessions', '');
      figma.root.setPluginData('vote_records', '');
      figma.ui.postMessage({ type: 'reset-done' });
      figma.notify('모든 투표 데이터가 초기화되었습니다.');
      break;
    }
  }
  } catch (err) {
    console.error('Plugin error:', err);
    figma.ui.postMessage({ type: 'error', payload: String(err) });
  }
};
