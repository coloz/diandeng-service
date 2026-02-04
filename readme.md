# 点灯Broker Lite

diandeng-broker是一个nodejs编写的mqtt broker服务。
aedes为基础组件，Fastify提供必要的HTTP服务，使用Map缓存，使用SQLite做持久化；
设备端可以是手机app、web页面、esp32、arduino等，可通过mqtt连接到本broker上；
同时提供HTTP接口，让设备可以HTTP接入，用HTTP接口实现类似发布和订阅的效果；

## 快速开始

### 开发模式
```bash
npm install
npm start          # 启动所有服务 (MQTT Broker + HTTP API)
npm run broker     # 仅启动 MQTT Broker
npm run web        # 仅启动 HTTP API 服务
```

### 构建生产版本
```bash
npm run build      # 构建到 dist 目录
```

构建后的使用方法：
```bash
cd dist
npm install
node cli.js        # 启动所有服务
node cli.js broker # 仅启动 MQTT Broker
node cli.js web    # 仅启动 HTTP API 服务
```

### CLI 命令
```bash
node cli.js [命令]

命令:
  all, start    启动所有服务 (MQTT Broker + HTTP API) [默认]
  broker        仅启动 MQTT Broker 服务
  web           仅启动 HTTP API 服务
  help          显示帮助信息
  version       显示版本信息
```

### 环境变量
```bash
MQTT_PORT=1883    # MQTT 服务端口
HTTP_PORT=3000    # HTTP API 端口
WEB_PORT=3001     # Web API 端口
WS_PORT=8083      # WebSocket 端口
```

首次运行自动创建和初始化数据库

## 设备注册
该接口用于提供给APP/WEB端，用户通过该接口可以创建出一个新设备
```js
POST /device/auth
BODY {
    uuid:uuid,
    token:token
}
```

Response
```js
{
    message: 1000
    detail: {
        authKey:authKey
    }
}
```

## 设备上线
设备需要先使用HTTPClient获取到对应的链接信息
```
GET /device/auth?authKey={authKey}
```
Response
```js
{
    message: 1000
    detail: {
        host:'mqtt://broker.diandeng.tech',
        port:'1883'
        clientId: clientId,
        username: username,
        password: password
        uuid: '9140dxx9843bxxd6bc439exxxxxxxxxx'
    }
}
```

## 设备发布&&订阅
### 设备发布
设备向Topic发布信息后，broker会获取其中的toDevice信息，并将该信息转发到指定设备
```
TOPIC /device/{clientId}/s
```
```js
{"toDevice":"xxxxxxxx","data":{"get":"state"}}
```
toDevice：目标设备
data：承载数据

### 设备订阅
```
TOPIC /device/{deviceName}/r
```
```js
{"fromDevice":"xxxxxxxx","data":{"get":"state"}}
```

## 组发布&&订阅
Broker以组（Group）进行权限鉴别，在同一组内的设备可以相互通信
例如：两个设备都是同一用户创建的，这两个设备将都在同一用户组中，因此可以相互通信。
## 向组发送数据
```
TOPIC /group/groupName/s
```
```
{"toGroup":"xxx","data":{"get":"state"}}
```
## 订阅组中的数据
接收组发来的数据
```
TOPIC /group/groupName/r
```
```
{"fromGroup":"xxx","data":{"get":"state"}}
```


## 限制机制
1. 一个authkey只能一个设备使用，每次获取连接信息，都将重置连接凭证
2. 设备只能发布和订阅属于自身的topic，如果操作其他topic将被broker断开连接
3. 设备消息发布频率最高每秒1次，否则将被broker断开连接
4. 每条消息长度不能大于1024，否则将被broker断开连接
5. 设备只能和所在组（Group）的其他设备通信, 1个设备可以在多个组中