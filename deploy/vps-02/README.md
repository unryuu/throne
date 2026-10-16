# vps-02 部署文件

步骤与改动清单见仓库根目录 HANDOFF.md；服务配置说明见 docs/deployment.md。

- `nginx-stream.conf`：443 按 SNI 分流，1566.unryuu.top 进游戏，其余交给 xray（xray 改听 127.0.0.1:10443）。
- `throne-site.conf`：80 跳转与证书验证，127.0.0.1:8443 的 HTTPS 反代到 4173。
- `throne.service`、`throne.env.example`：systemd 单元与环境文件。
