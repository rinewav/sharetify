# 中央サーバーの置き方

流れるのは識別子・メタデータ・再生位置だけで、音声は通らない。
だから小さくてよく、家の機械で足りる。

## 置いてあるもの

- `packages/hub/Dockerfile` — 中央サーバーの入れ物
- `deploy/compose.yaml` — MiniServer で走らせるための構成

外に出す役 (cloudflared) は MiniServer で既に動いているので、
ここでは中央サーバーだけを立て、その役から見える所に置いている。

## 手順

```bash
ssh user_1@100.91.43.19
cd ~/apps/sharetify
git pull
cd deploy
docker compose up -d --build
```

状態を見る:

```bash
docker compose ps
docker compose logs -f hub
curl -s http://127.0.0.1:47820/api/health
```

## 覚えているもの

利用者・集まり・並び・気に入った曲は `hub-data` という入れ物の外の置き場に残る。
入れ物を作り直しても消えない。中身を見るには:

```bash
docker exec sharetify-hub cat /app/data/hub.json
```

## 外への出し方

MiniServer の cloudflared は機械の網をそのまま使っているので、
`http://127.0.0.1:47820` がそのまま見える。
Cloudflare 側で経路を足すだけでよい。

  Zero Trust → Networks → Tunnels → 該当のトンネル → Public Hostname

| 項目 | 値 |
| --- | --- |
| Subdomain | `sharetify` |
| Domain | `rine.bio` |
| Service | `HTTP` / `localhost:47820` |

同時リスニングは常時つないだ経路を使うので、
その経路が保たれる設定になっていることも確かめておく。

## 上げ直す

```bash
cd ~/apps/sharetify && git pull && cd deploy && docker compose up -d --build
```

古い入れ物が溜まってきたら:

```bash
docker image prune -f
```
