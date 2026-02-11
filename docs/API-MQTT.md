# 点灯Broker Lite - MQTT接口文档

MQTT协议接口，用于设备实时消息通信。

**Broker地址**: `mqtt://localhost:1883`

---

## 目录
- [MQTT连接](#mqtt连接)
- [设备发布](#设备发布)
- [时序数据上报](#时序数据上报)
- [设备订阅](#设备订阅)
- [组发布](#组发布)
- [组订阅](#组订阅)
- [限制机制](#限制机制)

---

## MQTT连接

使用从 `GET /device/auth` 获取的连接信息连接到MQTT Broker。

**连接参数**
| 参数 | 值 |
|------|------|
| Host | mqtt://localhost |
| Port | 1883 |
| Client ID | 从接口获取的 clientId |
| Username | 从接口获取的 username |
| Password | 从接口获取的 password |

**示例（Node.js）**
```javascript
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'device_abc123def456',
  username: 'user_9140dxx9',
  password: 'xxxxxxxxxxxxxxxxx'
});

client.on('connect', () => {
  console.log('已连接到Broker');
});
```

**示例（Arduino/ESP8266）**
```cpp
#include <PubSubClient.h>
#include <ESP8266WiFi.h>

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  client.setServer("broker.example.com", 1883);
  client.connect("device_abc123def456", "user_9140dxx9", "xxxxxxxxxxxxxxxxx");
}
```

---

## 设备发布

设备向指定设备发送消息。

**Topic**
```
/device/{clientId}/s
```
> `{clientId}` 为当前设备自己的clientId

**消息格式**
```json
{
  "toDevice": "device_target123",
  "ts": false,
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toDevice | string | 是 | 目标设备的clientId |
| ts | boolean | 否 | 是否为时序数据，默认 false。为 true 时 data 中的键值对将被持久化到数据库 |
| data | object | 是 | 承载数据，当 ts=true 时，值必须为数值类型 |

**示例**
```javascript
client.publish('/device/device_abc123def456/s', JSON.stringify({
  toDevice: 'device_target123',
  data: { cmd: 'toggle', value: true }
}));
```

> **注意**：设备只能发布到自己的 `/s` topic，发布到其他设备的topic将被断开连接。

---

## 时序数据上报

设备上报时序数据（如传感器数值），数据将自动持久化到 SQLite 数据库，同时消息仍会正常转发给目标设备。

**Topic**
```
/device/{clientId}/s
```
> 与设备发布使用相同的 Topic，通过 `ts: true` 标识时序数据

**消息格式**
```json
{
  "toDevice": "device_target123",
  "ts": true,
  "data": {
    "temperature": 25.6,
    "humidity": 60.2
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toDevice | string | 是 | 目标设备的clientId |
| ts | boolean | 是 | 必须为 true，标识为时序数据 |
| data | object | 是 | 键值对格式，键为数据名称（dataKey），值必须为数值类型 |

**持久化字段说明**

| 字段 | 说明 |
|------|------|
| device_uuid | 发送设备的 UUID，通过 Topic 中的 clientId 自动获取 |
| data_key | data 对象中的键名（如 "temperature"、"humidity"） |
| value | 对应的数值 |
| timestamp | 服务器接收时的时间戳（毫秒） |

**示例**
```javascript
// 上报温湿度时序数据
client.publish(`/device/${config.clientId}/s`, JSON.stringify({
  toDevice: 'device_target123',
  ts: true,
  data: {
    temperature: 25.6,
    humidity: 60.2
  }
}));
```

> **注意**：`data` 中的非数值字段将被跳过，不会写入数据库。

---

## 设备订阅

订阅接收发给自己的消息。

**Topic**
```
/device/{clientId}/r
```
> `{clientId}` 为当前设备自己的clientId

**接收消息格式**
```json
{
  "fromDevice": "device_sender123",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| fromDevice | string | 发送设备的clientId |
| data | object | 承载数据 |

**示例**
```javascript
client.subscribe('/device/device_abc123def456/r');

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log('收到消息:', data);
});
```

> **注意**：设备只能订阅自己的 `/r` topic，订阅其他设备的topic将被断开连接。

---

## 组发布

向组内所有设备广播消息。

**Topic**
```
/group/{groupName}/s
```

**消息格式**
```json
{
  "toGroup": "my_group_name",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toGroup | string | 是 | 目标组名称 |
| data | object | 是 | 承载数据 |

**示例**
```javascript
client.publish('/group/my_group_name/s', JSON.stringify({
  toGroup: 'my_group_name',
  data: { cmd: 'sync', timestamp: Date.now() }
}));
```

> **注意**：设备只能向自己所在的组发布消息，向其他组发布将被拒绝。

---

## 组订阅

订阅组内的广播消息。

**Topic**
```
/group/{groupName}/r
```

**接收消息格式**
```json
{
  "fromGroup": "my_group_name",
  "fromDevice": "device_sender123",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| fromGroup | string | 来源组名称 |
| fromDevice | string | 发送设备的clientId |
| data | object | 承载数据 |

**示例**
```javascript
client.subscribe('/group/my_group_name/r');

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log('收到组消息:', data);
});
```

> **注意**：设备只能订阅自己所在组的消息，订阅其他组将被拒绝。

---

## Topic权限汇总

| Topic格式 | 操作 | 权限说明 |
|-----------|------|----------|
| `/device/{clientId}/s` | 发布 | 只能发布到自己的clientId |
| `/device/{clientId}/r` | 订阅 | 只能订阅自己的clientId |
| `/group/{groupName}/s` | 发布 | 只能发布到自己所在的组 |
| `/group/{groupName}/r` | 订阅 | 只能订阅自己所在的组 |

---

## 限制机制

| 限制项 | 说明 | 违规后果 |
|--------|------|----------|
| Topic权限 | 设备只能发布和订阅属于自身的topic | 断开连接 |
| 发布频率 | 每秒最多发布1条消息 | 断开连接 |
| 消息长度 | 每条消息不能大于1024字节 | 断开连接 |
| 组权限 | 设备只能和所在组的其他设备通信 | 消息被拒绝 |
| 认证凭证 | 每次获取连接信息都会重置凭证 | 旧凭证失效 |

---

## 完整示例

### Node.js 设备端示例

```javascript
const mqtt = require('mqtt');

// 连接参数（从 GET /device/auth 获取）
const config = {
  clientId: 'device_abc123def456',
  username: 'user_9140dxx9',
  password: 'xxxxxxxxxxxxxxxxx'
};

// 连接Broker
const client = mqtt.connect('mqtt://localhost:1883', config);

client.on('connect', () => {
  console.log('已连接到Broker');
  
  // 订阅自己的接收topic
  client.subscribe(`/device/${config.clientId}/r`);
  
  // 订阅组消息（假设已加入 my_group）
  client.subscribe('/group/my_group/r');
});

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  
  if (topic.includes('/device/')) {
    console.log('收到设备消息:', data);
  } else if (topic.includes('/group/')) {
    console.log('收到组消息:', data);
  }
});

// 发送消息给其他设备
function sendToDevice(targetClientId, payload) {
  client.publish(`/device/${config.clientId}/s`, JSON.stringify({
    toDevice: targetClientId,
    data: payload
  }));
}

// 发送组广播消息
function sendToGroup(groupName, payload) {
  client.publish(`/group/${groupName}/s`, JSON.stringify({
    toGroup: groupName,
    data: payload
  }));
}

// 使用示例
sendToDevice('device_target123', { cmd: 'toggle', value: true });
sendToGroup('my_group', { cmd: 'sync', timestamp: Date.now() });
```
