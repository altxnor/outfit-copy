import {
  Extension,
  HDirection,
  HPacket,
  HEntity,
  HGender,
  HEntityType,
} from "gnode-api";

const extensionInfo = {
  name: "Outfit Copy",
  description: "Copy everyone's outfit",
  version: "0.1.1",
  author: "altxnor",
};

const ext = new Extension(extensionInfo);
ext.run();

ext.on("click", () => {
  extState = !extState;
  const state = extState ? "on" : "off";
  sendFeedbackMessage(`Extension is now ${state}`);
});

ext.interceptByNameOrHash(HDirection.TOSERVER, "Chat", onUserMessage);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "Users", onUsers);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "UserChange", onUserChange);
// ext.interceptByNameOrHash(HDirection.TOCLIENT, "UserRemove", onUserRemove);
ext.interceptByNameOrHash(HDirection.TOSERVER, "Quit", resetData);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "RoomReady", resetData);

let extState = true;
let myIdx = -1;
let usersEntitiesRoom = [];
let shouldStopCycling = true;
const MAX_USERS = 400;
const usersEntities = [];

const outfitCombinePatterns = [
  // keep hair, legs and head
  /\b(?:hr|lg|hd)[^.\s]*\b/g,
  /\b(?:hr|lg|hd)[^.\s]*\.?\b/g,

  // keep hair, head
  /\b(?:hr|hd)[^.\s]*\b/g,
  /\b(?:hr|hd)[^.\s]*\.?\b/g,

  // keep everything on the head
  /\b(?:hr|hd|he|ha|ea|fa)[^.\s]*\b/g,
  /\b(?:hr|hd|he|ha|ea|fa)[^.\s]*\.?\b/g,
];

function resetData() {
  usersEntitiesRoom.forEach((user) => {
    const existingUserId = usersEntities.findIndex((u) => u.id === user.id);
    if (existingUserId >= 0) {
      usersEntities[existingUserId] = user;
    } else {
      if (usersEntities.length >= MAX_USERS) usersEntities.shift();
      usersEntities.push(user);
    }
  });
  myIdx = -1;
  usersEntitiesRoom = [];
  shouldStopCycling = true;
}

function getEntityByName(arr, name) {
  return arr.find((user) => user.name.toLowerCase() === name.toLowerCase());
}

function getEntityByIndex(arr, index) {
  return arr.find((user) => user.index === index);
}

function hasNoUsers() {
  if (usersEntitiesRoom.length === 0) {
    sendFeedbackMessage(`No users found or you need to reenter the room`);
    return true;
  }
  return false;
}

function onUserMessage(hMessage) {
  const message = hMessage.getPacket().readString();
  if (!extState) return;

  const messageCommand = message.split(" ")[0];
  const args = message.replace(messageCommand, "").trim();

  switch (messageCommand) {
    case ":copy":
      handleCopyCommand(hMessage, args);
      break;
    case ":ofc":
    case ":outfitcombine":
      handleOutfitCombineCommand(hMessage, args);
      break;
    case ":outfitcycle":
      handleOutfitCycleCommand(hMessage);
      break;
    case ":outfitstop":
      hMessage.blocked = true;
      shouldStopCycling = true;
      break;
  }
}

function onUsers(hMessage) {
  const users = HEntity.parse(hMessage.getPacket());
  if (myIdx === -1) myIdx = users[0]?.index || -1;

  if (!extState) return;
  for (const userEntity of users) {
    if (userEntity.entityType !== HEntityType.HABBO) continue;

    const user = {
      id: userEntity.id,
      name: userEntity.name,
      index: userEntity.index,
      gender: userEntity.gender,
      figureData: userEntity.figureId,
    };

    let userIndex = usersEntitiesRoom.findIndex((u) => u.id === user.id);
    if (userIndex >= 0) {
      usersEntitiesRoom[userIndex] = user;
    } else {
      usersEntitiesRoom.push(user);
    }
  }
}

function onUserChange(hMessage) {
  const userChange = hMessage.getPacket().read("iSS");

  if (!extState) return;
  const userIndex = parseInt(userChange[0]);
  const userFigureData = userChange[1].toString();
  const userGender = userChange[2].toString();
  const userEntityRoom = getEntityByIndex(usersEntitiesRoom, userIndex);
  if (!userEntityRoom) return;

  userEntityRoom.figureData = userFigureData;
  userEntityRoom.gender = userGender === "m" ? HGender.Male : HGender.Female;
}

function onUserRemove(hMessage) {
  const userIndex = parseInt(hMessage.getPacket().readString());
  if (!extState) return;
  const userArrIndex = usersEntitiesRoom.findIndex(
    (u) => u.index === userIndex
  );
  if (userArrIndex < 0) return;
  usersEntitiesRoom.splice(userArrIndex, 1);
}

function handleCopyCommand(hMessage, args) {
  hMessage.blocked = true;
  if (hasNoUsers()) return;

  const userName = args;

  let userEntity =
    getEntityByName(usersEntitiesRoom, userName) ||
    getEntityByName(usersEntities, userName);

  if (!userEntity) {
    sendFeedbackMessage(`${userName} not found.`);
    return;
  }

  updateFigureData(userEntity);
}

function handleOutfitCombineCommand(hMessage, args) {
  hMessage.blocked = true;
  const params = args.split(" ");
  if (params.length < 2 || hasNoUsers()) return;

  const outfitCombineType = isNaN(params[params.length - 1])
    ? 3
    : parseInt(params.pop());

  const users = params
    .map(
      (name) =>
        getEntityByName(usersEntitiesRoom, name) ||
        getEntityByName(usersEntities, name)
    )
    .filter((u) => u != null);

  if (users.length >= 2) {
    combineOutfit(users, outfitCombineType);
  }
}

function handleOutfitCycleCommand(hMessage) {
  hMessage.blocked = true;
  if (hasNoUsers() || usersEntitiesRoom.length < 2) return;
  shouldStopCycling = false;
  cycleOutfit(1, 5000);
}

function combineOutfit(users, type = 1) {
  let index = (type - 1) * 2;
  const pattern1 = outfitCombinePatterns[index];
  const pattern2 = outfitCombinePatterns[index + 1];

  const baseFigure = users[0].figureData.match(pattern1).join(".");
  const topFigure = users[1].figureData.replace(pattern2, "");

  const combinedFigures = `${baseFigure}.${topFigure}`;

  updateFigureData({
    figureData: combinedFigures,
    gender: users[0].gender,
  });
}

function cycleOutfit(i, delay) {
  if (i >= usersEntitiesRoom.length || shouldStopCycling) return;

  updateFigureData(usersEntitiesRoom[i]);

  setTimeout(() => cycleOutfit(i + 1, delay), delay);
}

function sendFeedbackMessage(message, shout = true) {
  const type = shout ? "Shout" : "Chat";
  const msgPacket = new HPacket(type, HDirection.TOCLIENT)
    .appendInt(myIdx)
    .appendString(message)
    .appendInt(1)
    .appendInt(33)
    .appendInt(0)
    .appendInt(0);

  ext.sendToClient(msgPacket);
}

function updateFigureData(entity) {
  if (entity == null) return;
  const figureData = entity.figureData;
  const gender = entity.gender;

  if (figureData == null || gender == null) {
    return;
  }

  const packet = new HPacket("UpdateFigureData", HDirection.TOSERVER)
    .appendString(gender)
    .appendString(figureData);

  ext.sendToServer(packet);
}
