# XMTP Agent Quickstart Sandbox

这个目录是和主项目隔离的最小可运行 XMTP Agent 测试。

## 1) 安装依赖

```powershell
npm install
```

## 2) 配置环境变量（PowerShell）

```powershell
$env:XMTP_ENV="dev"
$env:WALLET_KEY="0x你的私钥"
```

## 3) 启动

```powershell
npm start
```

成功后会打印：

- `Address`
- `Inbox ID`
- `Test URL`
- `Waiting for messages...`

你可以用 `Test URL` 打开的页面给这个 agent 发消息，agent 会自动回复 `echo: <你发的文本>`。
