# 维护与隐私

公开文档描述功能、安装、限制、验证方法和上游来源。测试使用合成数据，不上传个人设备记录、原始抓包、真实后台地址、认证信息或使用者的 Surge 配置。

提交前，从 GitHub 的 **Settings → Emails** 获取账号专用的隐私邮箱，并在本仓库设置：

```sh
git config --local user.name 'YOUR_GITHUB_USERNAME'
git config --local user.email 'YOUR_GITHUB_NOREPLY_EMAIL'
git config --local user.useConfigOnly true
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git diff --cached
```

将占位符替换为自己的 GitHub 用户名及 `users.noreply.github.com` 邮箱。作者和提交者都应使用隐私身份；环境变量也可能覆盖 Git 配置，需要核对实际生效值。

历史重写后，已有克隆应先备份未提交工作，优先重新克隆。不要合并旧历史，也不要从旧克隆强制推送。分支历史清理无法撤回其他人保存的副本；平台缓存需由平台另行处理。

固定安装地址和版本资源路径应保持兼容。维护仓库无需修改使用者的 Surge 主配置或模块参数。
