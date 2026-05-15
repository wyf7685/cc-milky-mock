import type { ApiHandler } from '@/api/registry.js';

export function registerFileHandlers(handlers: Map<string, ApiHandler>): void {
  handlers.set('upload_private_file', ({ user_id, file_uri, file_name }, ctx) => {
    return { file_id: `pfile_${ctx.seq.next('file:private')}` };
  });

  handlers.set('upload_group_file', ({ group_id, parent_folder_id, file_uri, file_name }, ctx) => {
    const gid = Number(group_id);
    const fileId = `gfile_${ctx.seq.next(`file:group:${gid}`)}`;
    if (!ctx.state.groupFiles.has(gid)) ctx.state.groupFiles.set(gid, []);
    ctx.state.groupFiles.get(gid)!.push({
      groupId: gid,
      fileId,
      fileName: String(file_name),
      parentFolderId: String(parent_folder_id ?? '/'),
      fileSize: 0,
      uploadedTime: Math.floor(Date.now() / 1000),
      uploaderId: ctx.state.bot.uin,
      downloadedTimes: 0,
    });
    return { file_id: fileId };
  });

  handlers.set('get_private_file_download_url', ({ file_id }) => {
    return { download_url: `https://mock.milky.local/download/${file_id}` };
  });

  handlers.set('get_group_file_download_url', ({ group_id, file_id }) => {
    return { download_url: `https://mock.milky.local/download/group/${file_id}` };
  });

  handlers.set('get_group_files', ({ group_id, parent_folder_id }, ctx) => {
    const gid = Number(group_id);
    const parentId = String(parent_folder_id ?? '/');
    const files = (ctx.state.groupFiles.get(gid) ?? []).filter(
      (f) => f.parentFolderId === parentId,
    );
    const folders = (ctx.state.groupFolders.get(gid) ?? []).filter(
      (f) => f.parentFolderId === parentId,
    );
    return { files, folders };
  });

  handlers.set('move_group_file', ({ group_id, file_id, parent_folder_id, target_folder_id }, ctx) => {
    const gid = Number(group_id);
    const fid = String(file_id);
    const files = ctx.state.groupFiles.get(gid);
    const file = files?.find((f) => f.fileId === fid);
    if (file) file.parentFolderId = String(target_folder_id ?? '/');
    return {};
  });

  handlers.set('rename_group_file', ({ group_id, file_id, parent_folder_id, new_file_name }, ctx) => {
    const gid = Number(group_id);
    const fid = String(file_id);
    const files = ctx.state.groupFiles.get(gid);
    const file = files?.find((f) => f.fileId === fid);
    if (file) file.fileName = String(new_file_name);
    return {};
  });

  handlers.set('delete_group_file', ({ group_id, file_id }, ctx) => {
    const gid = Number(group_id);
    const fid = String(file_id);
    const files = ctx.state.groupFiles.get(gid);
    if (files) {
      const idx = files.findIndex((f) => f.fileId === fid);
      if (idx >= 0) files.splice(idx, 1);
    }
    return {};
  });

  handlers.set('create_group_folder', ({ group_id, folder_name }, ctx) => {
    const gid = Number(group_id);
    const folderId = `folder_${ctx.seq.next(`folder:group:${gid}`)}`;
    if (!ctx.state.groupFolders.has(gid)) ctx.state.groupFolders.set(gid, []);
    ctx.state.groupFolders.get(gid)!.push({
      groupId: gid,
      folderId,
      parentFolderId: '/',
      folderName: String(folder_name),
      createdTime: Math.floor(Date.now() / 1000),
      lastModifiedTime: Math.floor(Date.now() / 1000),
      creatorId: ctx.state.bot.uin,
      fileCount: 0,
    });
    return { folder_id: folderId };
  });

  handlers.set('rename_group_folder', ({ group_id, folder_id, new_folder_name }, ctx) => {
    const gid = Number(group_id);
    const fid = String(folder_id);
    const folders = ctx.state.groupFolders.get(gid);
    const folder = folders?.find((f) => f.folderId === fid);
    if (folder) folder.folderName = String(new_folder_name);
    return {};
  });

  handlers.set('delete_group_folder', ({ group_id, folder_id }, ctx) => {
    const gid = Number(group_id);
    const fid = String(folder_id);
    const folders = ctx.state.groupFolders.get(gid);
    if (folders) {
      const idx = folders.findIndex((f) => f.folderId === fid);
      if (idx >= 0) folders.splice(idx, 1);
    }
    return {};
  });
}
