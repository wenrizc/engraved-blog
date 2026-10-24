# 局域网常驻服务

本机使用用户级 systemd 托管博客和管理页。下表的 `<主机IP>` 替换为本机当前的局域网 IP：

| 页面     | 局域网地址              | 服务                     |
| -------- | ----------------------- | ------------------------ |
| 博客     | `http://<主机IP>:4321/` | `engraved-blog.service`  |
| 内容管理 | `http://<主机IP>:9797/` | `engraved-admin.service` |

两项服务监听 `0.0.0.0`，已启用开机启动和异常退出后自动重启。服务用户已启用 linger，退出登录后服务仍运行。设备需要能访问这台主机的网络；如果 DHCP 地址变化，使用新的主机 IP。管理页没有登录认证，只应在可信局域网开放；不要通过端口转发或公网代理暴露它。

博客以 Astro 实时预览模式运行：后台将内容设为“公开”并保存后，博客会读取文件变化，无需手动构建。草稿仍只在后台可见。这些更新只影响本机服务，独立托管的公网网站仍需要部署。

服务配置位于：

- `~/.config/systemd/user/engraved-blog.service`
- `~/.config/systemd/user/engraved-admin.service`

查看状态和日志：

```bash
systemctl --user status engraved-blog.service engraved-admin.service
journalctl --user -u engraved-blog.service -u engraved-admin.service -f
```

重启或停止：

```bash
systemctl --user restart engraved-blog.service engraved-admin.service
systemctl --user stop engraved-blog.service engraved-admin.service
```

禁用开机启动并停止：

```bash
systemctl --user disable --now engraved-blog.service engraved-admin.service
```

服务使用通过 nvm 安装的 Node。删除或更换 Node 安装路径后，需要更新两个服务的 `ExecStart` 和 `PATH`，执行 `systemctl --user daemon-reload` 并重启服务。所需 Node 版本见 `package.json` 的 `engines`。

Astro 7 的 CLI 路径已变更。博客服务应使用 `node <项目路径>/node_modules/.bin/astro dev --ignore-lock --host 0.0.0.0 --port 4321`，不要继续引用旧的 `node_modules/astro/astro.js`。`--ignore-lock` 让服务以前台进程运行，由 systemd 管理生命周期。
