import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const marker = '<!-- contribution-invite -->';

async function githubRequest(method, path, token, body) {
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

export async function runContributionInvite({ repository, actor, eventName, event, token, inviteToken, request = githubRequest }) {
  if (eventName !== 'workflow_dispatch' && !(eventName === 'issues' && event.action === 'labeled' && event.label?.name === 'accepted')) {
    return { status: 'skipped' };
  }
  const number = String(eventName === 'workflow_dispatch' ? event.inputs?.issue_number : event.issue?.number);
  if (!/^[1-9]\d*$/.test(number)) throw new Error('The issue number must be a positive integer.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('The repository name is invalid.');
  if (!token) throw new Error('GITHUB_TOKEN is missing, so the reviewer permission cannot be verified.');
  const prefix = `/repos/${repository}`;
  async function api(method, path, apiToken = token, body, allowed = [200]) {
    const response = await request(method, path, apiToken, body);
    if (!allowed.includes(response.status)) throw new Error(`GitHub API ${method} ${path} failed (HTTP ${response.status}).`);
    return response;
  }
  async function list(path, apiToken = token) {
    const items = [];
    for (let page = 1; ; page++) {
      const { data } = await api('GET', `${path}?per_page=100&page=${page}`, apiToken);
      items.push(...data);
      if (data.length < 100) return items;
    }
  }

  // Repository write access alone must not allow newly invited contributors to invite others.
  const reviewer = await api('GET', `${prefix}/collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain'].includes(reviewer.data.role_name || reviewer.data.permission) && !reviewer.data.user?.permissions?.maintain) {
    throw new Error('The reviewer needs admin or maintain permission on the repository to trigger a collaborator invitation.');
  }
  const { data: issue } = await api('GET', `${prefix}/issues/${number}`);
  const labels = new Set(issue.labels.map(label => typeof label === 'string' ? label : label.name));
  if (issue.pull_request || issue.state !== 'open' || !labels.has('contribution') || !labels.has('accepted') || issue.user.type !== 'User') {
    return { status: 'skipped' };
  }
  const author = issue.user.login;
  const permission = await api('GET', `${prefix}/collaborators/${encodeURIComponent(author)}/permission`, token, undefined, [200, 404]);
  let status = 'already-collaborator';
  if (permission.status !== 200 || !['admin', 'maintain', 'write'].includes(permission.data.permission)) {
    if (!inviteToken) throw new Error('Configure CONTRIBUTION_INVITE_TOKEN: authorize only the current repository, with Administration: Read and write. After configuring it, you can rerun this issue by hand.');
    const invitations = await list(`${prefix}/invitations`, inviteToken);
    if (invitations.some(invitation => invitation.invitee?.id === issue.user.id)) {
      status = 'invitation-pending';
    } else {
      const invitation = await api('PUT', `${prefix}/collaborators/${encodeURIComponent(author)}`, inviteToken, { permission: 'push' }, [201, 204]);
      status = invitation.status === 201 ? 'invited' : 'already-collaborator';
    }
  }

  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const nextStep = status === 'already-collaborator'
    ? 'You already have write access to the repository, so you can create a PR for this issue.'
    : `The collaborator invitation was sent or is still waiting to be accepted. First accept it through GitHub notifications or the [invitations page](${server}/${repository}/invitations), then create a PR.`;
  const body = `${marker}\n@${author}, this proposal passed maintainer review. ${nextStep}\n\nCollaborators have write access to the whole repository. Create a separate branch for this proposal, link #${number} in the PR, add the changes and verification results, and wait for the review to pass before merging. For detailed steps, see the [contribution guide](${server}/${repository}/blob/HEAD/.github/CONTRIBUTING.md).`;
  const comments = await list(`${prefix}/issues/${number}/comments`);
  const previous = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker));
  if (previous) {
    if (previous.body !== body) await api('PATCH', `${prefix}/issues/comments/${previous.id}`, token, { body });
  } else {
    await api('POST', `${prefix}/issues/${number}/comments`, token, { body }, [201]);
  }
  return { status, issue: Number(number), author };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await runContributionInvite({
      repository: process.env.GITHUB_REPOSITORY,
      actor: process.env.GITHUB_ACTOR,
      eventName: process.env.GITHUB_EVENT_NAME,
      event,
      token: process.env.GITHUB_TOKEN,
      inviteToken: process.env.CONTRIBUTION_INVITE_TOKEN,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
