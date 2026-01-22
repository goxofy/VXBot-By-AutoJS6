/**
 * WX模块
 * 
 * @author tmkook
 * @version 1.0.0
 * @description Support 8.0.38 版本
 * @since 2025-12-20
 */
export default {

    /**
     * 包名
     */
    package: 'com.tencent.mm',

    /**
     * 收到新消息(需要打开通知)
     * @param {Function(notification)} callback
     */
    onMessage(callback) {
        events.observeNotification();
        events.onNotification((notification) => {
            if (notification.getPackageName() === this.package) {
                device.wakeUpIfNeeded()
                callback(notification)
            }
        })
    },

    /**
     * 返回到主界面最多 20 步
     * 
     * @returns boolean
     */
    backToHome() {
        for (let i = 0; i < 20; i++) {
            sleep(random(500, 1000))
            if (this.isHome()) {
                return true
            }

            // [Fix] Smart Tab Switching
            // If we are on other tabs (Contacts/Discover/Me), simply click WeChat Tab (0)
            let currentTab = this.getCurrentTab();
            if (currentTab > 0) {
                // console.log("BackToHome: Current is Tab " + currentTab + ", clicking Tab 0.");
                if (this.setCurrentTab(0)) {
                    continue; // Wait for loop to confirm isHome()
                }
            }

            back()
        }
        return false
    },

    /**
     * 打开APP并进入主界面
     * 
     * @returns boolean
     */
    openApp() {
        launch(this.package)
        waitForPackage(this.package)
        device.keepScreenDim(600000)
        return this.backToHome()
    },

    /**
     * 任务完成返回桌面息屏等待
     * 
     * @returns boolean
     */
    finish() {
        device.cancelKeepingAwake()
        const ret = this.backToHome()
        if (ret) {
            // home() // 不返回桌面，留在微信
        }
        return ret
    },

    /**
     * 获取底部 Tabs
     * 
     * @returns UICollect | null
     */
    getTabs() {
        // 尝试在常用 depth 范围内查找包含所有Tab关键字的层级
        // 微信底部Tab关键字: 微信, 通讯录, 发现, 我
        for (let d = 10; d <= 25; d++) {
            let tabs = className("TextView").depth(d).find();
            if (tabs.length >= 4) {
                // 检查是否包含关键文本
                let texts = tabs.map(t => t.text());
                if (texts.indexOf("微信") > -1 && texts.indexOf("通讯录") > -1 &&
                    texts.indexOf("发现") > -1 && texts.indexOf("我") > -1) {

                    // 过滤出这四个Tab，确保顺序和数量
                    // 既然找到了包含这四个词的层级，通常这个层级的元素就是 tab 容器
                    // 为了安全，过滤出只包含这四个文本的元素
                    let targetTabs = tabs.filter(t => {
                        let txt = t.text();
                        return txt === "微信" || txt === "通讯录" || txt === "发现" || txt === "我";
                    });

                    if (targetTabs.length === 4) {
                        return targetTabs;
                    }
                }
            }
        }
        return null
    },

    /**
     * 获取当前 Tab 的索引值
     * 如果在主页则返回0到3的数字不在主页则返回-1
     * 
     * @returns number
     */
    getCurrentTab() {
        const tabs = this.getTabs()
        if (tabs) {
            for (let i in tabs) {
                if (tabs[i].selected()) {
                    return Number(i)
                }
            }
        }
        return -1
    },

    /**
     * 切换到指定 Tab 页
     * 
     * @returns boolean
     */
    setCurrentTab(index) {
        const tabs = this.getTabs()
        if (tabs && tabs[index]) {
            const rect = tabs[index].bounds()
            click(rect.centerX(), rect.centerY())
            sleep(random(100, 500))
            return true
        }
        return false
    },

    /**
     * 获取未读会话角标
     * 
     * @returns array
     */
    getUnreadSession() {
        // 使用 getSessionList 获取的列表来遍历查找红点
        // 这样比全局搜索更准确
        let list = this.getSessionList();
        let elements = []

        if (list) {
            for (let i = 0; i < list.childCount(); i++) {
                let item = list.child(i);
                if (item) {
                    // 遍历子元素查找红点特征
                    // 特征1: 带数字的 TextView (通常是 unread count)
                    // 特征2: 小红点 ImageView
                    // 简单起见，我们查找该 item 下所有的 TextView，如果 text 是数字且 visible
                    let textViews = item.find(className("TextView"));
                    for (let j = 0; j < textViews.size(); j++) {
                        let tv = textViews.get(j);
                        // 排除时间和名字，通常未读数比较短
                        let text = tv.text();
                        if (text && text.match(/^\d+$/) && tv.bounds().width() < 100 && tv.bounds().height() < 100) {
                            elements.push(item); // 把整个 item 加入，而不是只点击红点，点击 item 任何位置都可以
                            break;
                        }
                    }

                    // 如果还需要查找纯红点（无数字），可以通过 View 的大小来判断，通常很小
                    // 这里暂时略过，现代微信基本都有数字，除非是免打扰
                    if (elements.indexOf(item) === -1) {
                        let imageViews = item.find(className("ImageView"));
                        for (let k = 0; k < imageViews.size(); k++) {
                            let img = imageViews.get(k);
                            let rect = img.bounds();
                            // 红点通常很小, e.g. 20x20 - 40x40
                            if (rect.width() > 0 && rect.width() < 50 && rect.height() > 0 && rect.height() < 50) {
                                // 进一步过滤，排除头像是圆形的/方形的但比较大的情况
                                // 红点通常在右侧
                                if (rect.left > device.width / 2) {
                                    elements.push(item);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback 到旧逻辑但移除 depth
            const num = className("TextView").textMatches(/^\d+$/).find();
            num.forEach(item => {
                let r = item.bounds();
                if (r.width() < 100 && r.height() < 100) {
                    elements.push(item);
                }
            })
        }

        return elements
    },

    /**
     * 打开一个未读会话
     * 
     * @returns boolean
     */
    openUnreadSession() {
        let unreadItems = this.getUnreadSession()
        if (unreadItems.length > 0) {
            // 点击第一个未读会话
            let item = unreadItems[0];
            let rect = item.bounds();
            click(rect.centerX(), rect.centerY());
            return true
        }
        return false
    },

    /**
     * 获取有效的会话列表容器
     * 遍历所有列表，通过检查子项坐标有效性来找到真正的会话列表
     */
    getSessionList() {
        // 合并查找 RecyclerView 和 ListView
        // 有些设备或微信版本可能使用不同的容器
        let allLists = [];
        let rvs = className("RecyclerView").find();
        if (!rvs.empty()) {
            // console.log("Found " + rvs.size() + " RecyclerViews");
            rvs.forEach(rv => allLists.push(rv));
        }
        let lvs = className("ListView").find();
        if (!lvs.empty()) {
            // console.log("Found " + lvs.size() + " ListViews");
            lvs.forEach(lv => allLists.push(lv));
        }

        for (let i = 0; i < allLists.length; i++) {
            let list = allLists[i];
            let listRect = list.bounds();

            // 过滤掉高度太小的容器（如顶部的搜索栏容器、底部的Tab栏容器）
            // 主会话列表通常占据屏幕大部分高度，保守估计大于 600 (这里假设屏幕高度通常 > 1280)
            if (listRect.height() < 400) { // Lowered threshold from 600 to 400
                continue;
            }
            // 尝试获取第一个可见的子项来判断列表是否有效
            let firstItem = list.child(0);
            if (!firstItem) {
                continue;
            }
            let rect = firstItem.bounds();

            // 跳过顶部的搜索栏/小程序入口 (index 0 且 top 在顶部)
            if (i === 0 && rect.top >= 0 && rect.top < 100) {
                continue;
            }

            // 确保中心点在屏幕内且坐标为正数
            // 阈值同步降低到 70
            if (rect.width() > 50 && rect.height() > 70 && rect.centerX() > 0 && rect.centerY() > 0) {
                return list;
            }
        }
        return null;
    },

    /**
     * 打开屏幕顶部第一个会话
     * 
     * @returns boolean
     */
    openTopSession() {
        let list = this.getSessionList();
        if (list) {
            // 遍历子项，找到第一个在屏幕内且坐标合法的项
            for (let i = 0; i < list.childCount(); i++) {
                let firstItem = list.child(i);
                if (firstItem) {
                    let rect = firstItem.bounds();
                    // 跳过顶部的搜索栏/小程序入口 (index 0 且 top 在顶部)
                    if (i === 0 && rect.top >= 0 && rect.top < 100) {
                        continue;
                    }

                    // 确保中心点在屏幕内且坐标为正数
                    // 阈值同步降低到 70
                    if (rect.centerX() > 0 && rect.centerY() > 0 && rect.width() > 50 && rect.height() > 70) {
                        click(rect.centerX(), rect.centerY());
                        return true;
                    }
                }
            }
        }
        return false
    },

    /**
     * 打开指定用户会话
     * @param {string} nickname 用户昵称
     * @returns boolean
     */
    openUserSession(nickname) {
        // [Async Fix] Ensure we start from clean state
        this.backToHome();

        // 尝试查找搜索按钮，去除 depth 限制
        let search = desc("搜索").findOne(2000);
        if (search) {
            search.click()
            // 查找输入框
            let edit = className("EditText").findOne(2000)
            if (edit) {
                edit.setText(nickname)
                sleep(1500);

                // 查找用户结果
                // 1. Exact Match First
                let user = className("TextView").text(nickname).findOne(2000);
                // 2. Contains Match Fallback (Be careful not to pick "Search related")
                // We assume the first valid contact result usually appears at top
                if (!user) {
                    // Filter out the search text itself 
                    user = className("TextView").textContains(nickname).find().filter(function (w) {
                        return w.text() !== nickname && w.id() !== ""; // Weak filter
                    })[0];
                }

                // Fallback: Just click the first list item below search bar
                if (!user) {
                    // Sometimes the result is a complex view group
                    // Try to find a list item
                    let list = className("ListView").findOne(1000) || className("RecyclerView").findOne(1000);
                    if (list && list.childCount() > 0) {
                        user = list.child(0);
                    }
                }

                if (user) {
                    const rect = user.bounds()
                    click(rect.centerX(), rect.centerY())
                    sleep(1000);

                    if (this.isChat()) {
                        return true;
                    }

                    // Retry Click
                    click(rect.centerX(), rect.centerY())
                    sleep(1000);
                    if (this.isChat()) {
                        return true;
                    }
                }
            }
        }
        back(); // Exit search
        return false;
    },

    /**
     * 置顶会话
     * 
     * @param {boolean} enable
     * @returns boolean
     */
    topSession(enable) {
        let list = this.getSessionList();
        if (list) {
            // 遍历子项，找到第一个在屏幕内且坐标合法的项
            for (let i = 0; i < list.childCount(); i++) {
                let firstItem = list.child(i);
                if (firstItem) {
                    let rect = firstItem.bounds();
                    // 跳过顶部的搜索栏/小程序入口 (index 0 且 top 在顶部)
                    if (i === 0 && rect.top >= 0 && rect.top < 100) {
                        continue;
                    }

                    // 确保中心点在屏幕内且坐标为正数
                    if (rect.centerX() > 0 && rect.centerY() > 0 && rect.width() > 50 && rect.height() > 70) {
                        // 长按条目中心
                        longClick(rect.centerX(), rect.centerY());
                        sleep(random(500, 1000));

                        let menuName = enable ? '置顶该聊天' : '取消置顶';
                        let menu = text(menuName).findOnce();
                        if (!menu) {
                            menu = textContains(enable ? "置顶" : "取消置顶").findOnce();
                        }

                        if (menu) {
                            menu.click();
                            return true;
                        } else {
                            click(device.width / 2, device.height / 2);
                        }
                        return false;
                    }
                }
            }
        }
        back();
        return false;
    },

    /**
     * 删除会话
     * 
     * @returns boolean
     */
    delSession() {
        let list = this.getSessionList();
        if (list) {
            for (let i = 0; i < list.childCount(); i++) {
                let firstItem = list.child(i);
                if (firstItem) {
                    let rect = firstItem.bounds();
                    if (i === 0 && rect.top >= 0 && rect.top < 100) {
                        continue;
                    }
                    if (rect.centerX() > 0 && rect.centerY() > 0 && rect.width() > 50 && rect.height() > 70) {
                        longClick(rect.centerX(), rect.centerY());
                        sleep(random(500, 1000));

                        let del = text("删除该聊天").findOnce();
                        if (!del) {
                            del = text("删除").findOnce();
                        }

                        if (del) {
                            del.click();
                            sleep(random(500, 1000));
                            let ok = text("知道了").findOnce();
                            if (ok) {
                                ok.click();
                                sleep(random(500, 1000));
                            }
                            let confirm = text("删除").findOnce();
                            if (confirm) {
                                confirm.click();
                                return true;
                            }
                        } else {
                            click(device.width / 2, device.height / 2);
                        }
                        return false;
                    }
                }
            }
        }
        back();
        return false;
    },

    /**
     * 是否开启了免打扰
     * 
     * @returns boolean
     */
    getDoNotDisturb() {
        return className("ImageView").depth(16).exists();
    },

    /**
     * 开启勿扰模式
     * 
     * @param {boolean} enable
     * @returns boolean
     */
    setDoNotDisturb(enable) {
        let status = this.getDoNotDisturb()
        if (status != enable) {
            let info = desc("聊天信息").findOnce()
            if (info) {
                info.click()
                sleep(random(500, 1000))
                const pos = text("查找聊天记录").findOnce()
                if (pos) {
                    const rect = pos.bounds()
                    click(rect.centerX(), rect.centerY() + random(150, 180))
                    sleep(random(500, 1000))
                    back()
                    return true
                }
                sleep(random(500, 1000))
                back()
            }
        }
        return false
    },



    /**
     * 退出群聊
     * 
     * @returns boolean
     */
    leaveGroup() {
        if (this.isGroupChat()) {
            desc("聊天信息").click()
            let list = className("ListView").findOne(2000)
            for (let i = 0; i < 10; i++) {
                list.scrollDown()
                const leave = text("退出群聊").findOne(2000)
                if (leave) {
                    let rect = leave.bounds()
                    click(rect.centerX(), rect.centerY())
                    let confirm = text("退出").findOne(2000)
                    if (confirm) {
                        confirm.click()
                    }
                    return true
                }
            }
            back()
        }
        return false
    },

    /**
     * 将会话列表滚动到顶部(双击顶部)
     * 
     * @returns boolean
     */
    scrollToFirstSession() {
        const rand = random(5, 10)
        const x = device.width * 0.7 + rand
        const y = 10 * rand
        click(x, y)
        click(x, y)
        return true
    },

    /**
     * 将下一个未读会话滚动到顶部(双击第一个Tab)
     * 
     * @returns boolean
     */
    scrollToNextUnreadSession() {
        const tabs = this.getTabs()
        if (tabs) {
            const rect = tabs[0].bounds()
            click(rect.centerX(), rect.centerY())
            click(rect.centerX(), rect.centerY())
            return true
        }
        return false
    },

    /**
     * 聊天中滚动到第一个未读消息
     * 
     * @returns boolean
     */
    scrollToUnreadMessage() {
        let more = className("LinearLayout").depth(14).findOnce()
        if (more) {
            more.click()
            return true
        }
        return false
    },

    /**
     * 打开聊天窗口工具
     * 
     * @returns boolean
     */
    openChatTools() {
        let album = className("TextView").text("相册").findOne(5000)
        if (!album) {
            const more = className("ImageButton").descContains("更多功能按钮").findOnce()
            if (more) {
                more.click()
                return true
            } else {
                return false
            }
        }
        return true
    },

    /**
     * 切换到文字输入
     * 
     * @returns boolean
     */
    switchToTextInput() {
        const keyboard = desc("切换到键盘").findOnce()
        if (keyboard) {
            keyboard.click()
            return true
        }
        return false
    },

    /**
     * 切换到语音输入
     * 
     * @returns boolean
     */
    switchToVoiceInput() {
        const voice = desc("切换到按住说话").findOnce()
        if (voice) {
            voice.click()
            return true
        }
        return false
    },

    /**
     * 发送文字
     * 
     * @returns boolean
     */
    sendText(content) {


        // 1. 检查是否有输入框，如果没有，尝试切换到文字模式
        if (!className("EditText").exists()) {
            this.switchToTextInput();
            sleep(500);
        }

        // 2. 再次查找输入框
        let input = className("EditText").findOnce();
        if (input) {
            // 点击输入框以获取焦点（可选，但推荐）
            // rect = input.bounds()
            // click(rect.centerX(), rect.centerY()) 
            // sleep(200)

            // 设置文本
            // [Fix] Append mode to support pre-existing @mention text
            let currentText = input.text();
            if (currentText && currentText.length > 0) {
                // Ensure space separation if needed, though WeChat usually adds space after @User
                input.setText(currentText + content);
            } else {
                input.setText(content);
            }
            sleep(500); // 等待发送按钮出现

            // 3. 查找发送按钮
            let btn = className("Button").text("发送").findOnce();
            if (btn) {
                btn.click();
                return true;
            } else {
                // 尝试一种备选方案：回车发送（视设置而定）
                // press(66) // KEYCODE_ENTER
            }
        }
        return false;
    },

    /**
     * 发送带艾特的消息 (回复群成员)
     * 
     * @param {string} who 被艾特的人昵称
     * @param {string} content 消息内容
     * @returns boolean
     */
    sendAtText(who, content) {
        if (!className("EditText").exists()) {
            this.switchToTextInput();
            sleep(500);
        }

        let input = className("EditText").findOnce();
        if (input) {
            input.click();
            sleep(200);

            // 1. Trigger Mention List (JUST "@")
            // User feedback: Inputting full "@Name" fails to trigger list. Must be just "@".
            input.setText("@");
            sleep(1500); // Wait for list popup

            // 2. Select User from List
            // The list should now be visible (e.g. "Select User" popup)
            // We search for the text of the username `who`

            // Try to find the text node strictly
            let match = text(who).visibleToUser(true).findOne(2000);

            if (!match) {
                // Try "Contains" if exact match fails
                match = textContains(who).visibleToUser(true).findOne(1000);
            }

            if (match) {
                console.log("Found mention candidate: " + match.text());
                let rect = match.bounds();
                // Safety Check for Click
                if (rect.centerX() < 0 || rect.centerY() < 0) {
                    console.error("Invalid bounds for mention match: " + rect);
                } else {
                    // Try clicking the item container (parent) first for better hit rate
                    // If parent is the ListView/RecyclerView, don't click it!
                    let p = match.parent();
                    if (p && !p.className().includes("RecyclerView") && !p.className().includes("ListView")) {
                        let pr = p.bounds();
                        click(pr.centerX(), pr.centerY());
                    } else {
                        click(rect.centerX(), rect.centerY());
                    }

                    // CRITICAL: Wait for WeChat to convert "@Tink" text into "[BlueBlock]"
                    sleep(1000);
                }
            } else {
                console.log("Mention list match failed for: " + who);
                // Fallback: Use search bar in the popup?
                // The screenshot shows a search bar with text "搜索"
                let searchBar = text("搜索").findOne(1000);
                if (searchBar) {
                    let sb = searchBar.bounds();
                    click(sb.centerX(), sb.centerY());
                    sleep(500);
                    // Now we are in search mode, type the name
                    setText(who);
                    sleep(1000);
                    // Try finding again
                    let searchMatch = text(who).visibleToUser(true).findOne(2000);
                    if (searchMatch) {
                        let smr = searchMatch.bounds();
                        click(smr.centerX(), smr.centerY());
                        sleep(1000);
                    }
                }
            }

            // 3. Append Content via Paste
            // [Fix] Add a leading space manually. 
            setClip(" " + content);
            sleep(200);

            // Re-focus input if needed
            input.click();
            sleep(200);

            if (!input.paste()) {
                let r = input.bounds();
                longClick(r.centerX(), r.centerY());
                sleep(800);
                let pasteBtn = text("粘贴").findOnce();
                if (pasteBtn) pasteBtn.click();
            }
            sleep(500);

            // 4. Send
            let btn = className("Button").text("发送").findOnce();
            if (btn) {
                btn.click();
                return true;
            }
        }
        return false;
    },

    /**
     * 发送自定义表情
     * @param {string} name 
     * @param {number} index 
     */
    sendCustomEmoji(name, index) {
        let keyboard = className("ImageButton").desc("键盘").findOnce()
        if (!keyboard) {
            let btn = className("ImageButton").desc("表情").findOne(1000)
            if (btn) {
                btn.click()
            }
        }
        let search = className("ImageView").desc("搜索表情").findOne(1000)
        if (search) {
            search.parent().click()
            // 改为检测输入框，而不是 "精选表情" 这种可能不存在的 title
            let edit = className("EditText").findOne(5000)
            if (edit) {
                // 模拟点击输入框以获取焦点
                edit.click();
                sleep(500);
                edit.setText(name)

                // 等待搜索结果加载
                sleep(2000);
                let searchBarBottom = edit.bounds().bottom;

                // 1. 尝试找 ImageView，移除 clickable(true) 限制
                // 只要在输入框下面足够远的位置（避免误点标签栏）
                let emojis = className("ImageView").find().filter(item => {
                    let b = item.bounds();
                    return b.top > searchBarBottom + 50 && b.width() > 50 && b.height() > 50;
                });

                // 2. 如果找不到符合条件的 ImageView，尝试找 RecyclerView (结果列表) 的子view
                if (emojis.length === 0) {
                    let list = className("RecyclerView").findOne(2000);
                    if (list) {
                        let children = list.children();
                        if (children && children.length > 0) {
                            // 将 AutoJS Collection 转换为数组以便通用处理
                            children.forEach(c => emojis.push(c));
                        }
                    }
                }

                if (emojis.length > 0) {
                    if (!index) {
                        index = 0
                    }
                    // 确保 index 不越界
                    if (index >= emojis.length) index = 0;

                    let rect = emojis[index].bounds()
                    click(rect.centerX(), rect.centerY())
                    return true
                }
            }
        }
        back()
        return false
    },

    /**
     * 发送图片
     * @param {array} index 相册中的图片索引
     * @param {boolean} source 是否发送原图
     * 
     * @returns boolean
     */
    sendPhoto(index, source) {
        if (this.isChat() && this.openChatTools()) {
            let album = className("TextView").text("相册").findOne(5000)
            if (album) {
                let rect = album.parent().bounds();
                click(rect.centerX(), rect.centerY())
                let preview = className("TextView").text("预览").findOne(5000)
                if (preview) {
                    if (source) {
                        click("原图")
                    }
                    const photos = className("CheckBox").depth(12).find()
                    if (photos.nonEmpty()) {
                        let has = false
                        for (let i in index) {
                            if (photos[i]) {
                                has = true
                                photos[i].click()
                                sleep(500)
                            }
                        }
                        if (has) {
                            click('发送')
                            return true
                        } else {
                            back()
                        }
                    }
                }
            }
        }
        return false
    },

    /**
     * 发送视频 (默认发送相册最新的一项)
     * @returns boolean
     */
    sendVideo() {
        // Reuse sendPhoto logic logic effectively, checking the first item
        // Video and Photo are mixed in Album.
        return this.sendPhoto([0], false);
    },

    /**
     * 接收新的好友请求
     * 
     * @returns boolean
     */
    receiveNewFriendRequest() {
        if (this.setCurrentTab(1)) {
            let menu = text("新的朋友").findOnce()
            if (menu) {
                let rect = menu.bounds()
                click(rect.centerX(), rect.centerY())
                sleep(random(500, 1000))
                return true
            }
        }
        return false
    },

    /**
     * 接收聊天窗口的好友请求(删的好友)
     * 
     * @returns boolean
     */
    receiveOldFriendRequest() {
        let has = text("对方还不是你的朋友").findOnce()
        if (has) {
            let rect = has.bounds()
            click(rect.centerX(), rect.centerY())
            sleep(random(500, 1000))
            let contact = text("添加到通讯录").findOnce()
            if (contact) {
                let rect2 = contact.bounds()
                click(rect2.centerX(), rect2.centerY())
                sleep(random(500, 1000))
                text("完成").click()
                return true
            }
        }
        return false
    },

    /**
     * 是否在主界面
     * 
     * @returns boolean
     */
    isHome() {
        return this.getCurrentTab() === 0
    },

    /**
     * 是否在聊天界面
     * 
     * @returns boolean
     */
    isChat() {
        return className("ImageButton").descContains("切换").exists()
    },

    /**
     * 是否是群聊
     * 
     * @returns boolean
     */
    isGroupChat() {
        return className("TextView").depth(21).exists()
    },

    /**
     * 是否是公众号
     * 
     * @returns boolean
     */
    isOfficialAccount() {
        return desc("公众号").exists()
    },

    /**
     * 是否是公众号
     * 
     * @returns boolean
     */
    isServiceAccount() {
        return desc("服务号").exists()
    },

    /**
     * 是否是企微
     * 
     * @returns boolean
     */
    isWorkAccount() {
        return className("TextView").depth(10).exists()
    },

    /**
     * 是否是服务通知
     * 
     * @returns boolean
     */
    isServiceNotice() {
        return desc("更多").exists()
    },

    /**
     * 获取当前聊天窗口标题
     * 
     * @returns string
     */
    getTitle() {
        // 策略1: 查找“返回”按钮旁边的文本
        let backBtn = desc("返回").findOnce();
        if (backBtn) {
            let parent = backBtn.parent();
            if (parent) {
                // 遍历同级节点
                let views = parent.find(className("TextView"));
                for (let i = 0; i < views.size(); i++) {
                    let t = views.get(i).text();
                    // 排除空文本和数字（通常是未读数）
                    if (t && t.length > 0 && !t.match(/^\d+$/)) {
                        return t;
                    }
                }
            }
        }

        // 策略2: 顶部区域扫描
        let titleView = className("TextView").boundsInside(0, 0, device.width, 200).find();
        for (let i = 0; i < titleView.size(); i++) {
            let t = titleView.get(i).text();
            // 排除系统状态栏时间等
            if (t && t.length > 0 && !t.match(/^\d+:\d+$/) && t !== "微信") {
                // 排除 "返回" 文本本身（如果有）
                if (t === "返回") continue;
                return t;
            }
        }

        return "Unknown";
    },

    /**
     * 获取聊天消息
     * 
     * @returns [MessageObject]
     */
    getMessages() {
        let messages = [];
        let list = classNameContains("RecyclerView").depth(17).findOnce()
        if (list) {
            let recents = list.children()
            recents.forEach((item) => {
                messages.push(new MessageObject(item))
            });
        }
        return messages
    },

    /**
     * 获取会话标题 (当前界面顶部标题)
     */
    getChatTitle() {
        let titles = className("TextView").find();
        for (let i = 0; i < titles.size(); i++) {
            let t = titles.get(i);
            let rect = t.bounds();
            if (rect.top >= 0 && rect.bottom < 200 && t.text().length > 0) {
                if (t.text() === "返回" || t.text().includes("消息") || t.text().includes("(")) continue;
                return t.text();
            }
        }
        return null;
    },

    /**
     * 获取会话列表条目标题 (列表扫描用)
     */
    getSessionTitle(item) {
        if (!item) return "";
        let tvs = item.find(className("TextView"));
        if (tvs && tvs.size() > 0) {
            for (let i = 0; i < tvs.size(); i++) {
                let t = tvs.get(i).text();
                if (!t) continue;
                if (t.match(/^\d+$/) && t.length < 4) continue;
                if (t.match(/\d+:\d+/) || t.match(/昨天/) || t.match(/星期/)) continue;
                return t.trim();
            }
        }
        return "";
    },

    /**
     * 获取聊天界面最后一条有效的对方消息
     * @returns {object|null} { text: string, type: string, sender: string }
     */
    /**
     * 获取当前会话中，自上一条“自己发的消息”之后的所有好友消息 (批量)
     * @returns {Array} List of message objects
     */
    getRecentMessages() {
        // [Fix] Strict Container Search
        // Prevent selecting RootView which merges Title + Message
        let list = className("RecyclerView").findOne(2000);
        if (!list) {
            list = className("ListView").findOne(1000);
        }

        // If no list found, we cannot reliably read messages.
        if (!list) return [];

        let allItems = list.children();
        let messages = [];

        if (allItems && allItems.size() > 0) {
            // 从下往上找
            for (let i = allItems.size() - 1; i >= 0; i--) {
                let item = allItems.get(i);

                // Skip invalid items (e.g. date separators often are small/different)
                if (!item) continue;

                // 找头像
                let head = item.findOne(className("ImageView").descContains("头像"));
                if (!head) {
                    // [Fix] Time Separator Check
                    // If we encounter an item without avatar, it might be a Timestamp.
                    // If it IS a timestamp, it indicates a time gap, so we should stop scanning older history.
                    let textViews = item.find(className("TextView"));
                    if (textViews.size() > 0) {
                        let t = textViews.get(0).text();
                        // Reuse valid timestamp regex
                        if (/^\s*\d{1,2}:\d{2}\s*$/.test(t) || /^((凌晨|早晨|早上|上午|中午|下午|傍晚|晚上|深夜|半夜|昨天|今天|明天|周|星期).*?\d{1,2}:\d{2}|^\d{2,4}[年\.\/-]\d{1,2}[月\.\/-]\d{1,2})/.test(t)) {
                            console.log(">> Reached Timestamp Separator [" + t + "], stopping scan.");
                            break;
                        }
                    }
                    continue;
                }

                // [Fix] Robustness: If avatar description is incomplete (just "头像"), 
                // it means the nickname hasn't loaded. Skip to avoid "Phantom Context" or failure to filter nickname from text.
                if (head.desc() === "头像") {
                    console.log("Skipping message with incomplete avatar desc");
                    continue;
                }

                // 判断头像位置
                let headRect = head.bounds();
                let isSelf = headRect.left > device.width / 2;

                if (isSelf) {
                    // 遇到自己发的消息，停止扫描 (认为之前的都已处理或不相关)
                    break;
                }

                // 是朋友的消息，提取内容
                let tv = null;
                let tvs = item.find(className("TextView"));

                let startIndex = 0;
                if (tvs.size() > 1) {
                    let firstText = tvs.get(0).text();
                    let headDesc = head.desc();
                    if (headDesc.indexOf(firstText) > -1 || firstText.length < headDesc.length) {
                        startIndex = 1;
                    }
                }

                // Collect all valid text parts
                let textParts = [];

                for (let j = startIndex; j < tvs.size(); j++) {
                    let t = tvs.get(j);
                    let txt = t.text().trim();

                    // Filter empty or too small views
                    if (t.bounds().height() <= 20 || txt.length === 0) continue;

                    // [Fix] Filter Timestamp
                    // 1. Strict Pure Time: "12:00", " 12:00 ", "12:00"
                    if (/^\s*\d{1,2}:\d{2}\s*$/.test(txt)) continue;

                    if (/^((凌晨|早晨|早上|上午|中午|下午|傍晚|晚上|深夜|半夜|昨天|今天|明天|周|星期).*?\d{1,2}:\d{2}|^\d{2,4}[年\.\/-]\d{1,2}[月\.\/-]\d{1,2})/.test(txt)) {
                        continue;
                    }

                    // [Fix] Filter Sender Name (Aggressive)
                    // If the text is exactly the sender's name (minus "头像" suffix), ignore it.
                    let senderName = head.desc().replace("头像", "");
                    if (txt === senderName || senderName.indexOf(txt) > -1) {
                        continue;
                    }

                    // [Fix] Filter Group Title Pattern
                    // Group titles often appear as "GroupName(N)" where N is member count
                    // This should NOT be part of a message bubble, but filter just in case
                    if (/^.+\(\d+\)$/.test(txt) && txt.length < 20) {
                        console.log(">> Filtered Group Title Pattern: [" + txt + "]");
                        continue;
                    }


                    textParts.push(txt);
                }

                if (textParts.length > 0) {
                    let senderName = head.desc();
                    if (senderName.indexOf("头像") > -1) {
                        senderName = senderName.replace("头像", "");
                    }

                    // 插入到数组开头 (保持时间顺序: 旧 -> 新)
                    messages.unshift({
                        text: textParts.join(" "), // Join parts with space
                        sender: senderName,
                        rect: item.bounds(),
                        headRect: head.bounds()
                    });
                }
            }
        }
        return messages;
    },

    getLatestMessage() {
        // [Fix] Also apply Strict Container Search for getLatestMessage
        let list = className("RecyclerView").findOne(2000);
        if (!list) list = className("ListView").findOne(1000);
        if (!list) return null;

        let allItems = list.children();
        let lastFriendMsg = null;

        if (allItems && allItems.size() > 0) {
            // 从下往上找
            for (let i = allItems.size() - 1; i >= 0; i--) {
                let item = allItems.get(i);

                // 找头像
                let head = item.findOne(className("ImageView").descContains("头像"));
                if (!head) continue;

                // 判断头像位置 (左=朋友, 右=自己)
                let headRect = head.bounds();
                if (headRect.left > device.width / 2) {
                    continue; // 忽略自己
                }

                // 找内容
                let tv = null;
                let tvs = item.find(className("TextView"));

                // [Fix] In group chats, the first TextView might be the user's nickname.
                // We try to identify the actual message body.
                let startIndex = 0;
                if (tvs.size() > 1) {
                    let firstText = tvs.get(0).text();
                    let headDesc = head.desc(); // e.g. "Tink头像"
                    // Simple fuzzy check: if header desc includes the text of the first view, likely it is the nickname
                    if (headDesc.indexOf(firstText) > -1 || firstText.length < headDesc.length) {
                        // Heuristic: If we have multiple texts, and the first one is short/similar to avatar, skip it.
                        // But usually nickname is small.
                        startIndex = 1;
                    }
                }

                // 过滤掉时间 (通常很小)
                for (let j = startIndex; j < tvs.size(); j++) {
                    let t = tvs.get(j);
                    // 气泡内的文字通常在这个 Item 的中间区域
                    if (t.bounds().height() > 20 && t.text().length > 0) {
                        tv = t;
                        break;
                    }
                }

                if (tv) {
                    let senderName = head.desc();
                    // Clean up "头像" suffix if present
                    if (senderName.indexOf("头像") > -1) {
                        senderName = senderName.replace("头像", "");
                    }

                    lastFriendMsg = {
                        text: tv.text(),
                        sender: senderName,
                        rect: item.bounds(),
                        headRect: head.bounds() // Export avatar bounds for long-click mention
                    };
                    break;
                }
            }
        }
        return lastFriendMsg;
    },

    /**
     * 分享视频到指定会话 (解决多线程并发文件混淆问题)
     * 使用 Android Intent 直接调起微信分享界面，指定通过 FileURI 发送特定文件。
     */
    shareVideoTo(path, who) {
        try {
            // [Fix] Android 7.0+ FileUriExposedException Bypass
            // This is a common hack in AutoJS to allow passing file:// URIs in Intents
            importClass(android.os.StrictMode);
            var builder = new StrictMode.VmPolicy.Builder();
            StrictMode.setVmPolicy(builder.build());

            // [Fix] Properly create URI
            var file = new java.io.File(path);
            var uri = android.net.Uri.fromFile(file);

            app.startActivity({
                action: "android.intent.action.SEND",
                type: "video/*",
                packageName: "com.tencent.mm",
                className: "com.tencent.mm.ui.tools.ShareImgUI",
                extras: {
                    "android.intent.extra.STREAM": uri
                }
            });

            // 2. 等待 "选择" 界面出现
            // 根据截图优化：标题 "选择一个聊天"，按钮 "+ 创建新的聊天"
            // 策略：检测标题、搜索框、或特定的列表头
            let prepared = text("选择一个聊天").findOne(5000)
                || text("创建新的聊天").findOne(5000)
                || text("最近聊天").findOne(5000)
                || textMatches(/.*选择.*/).findOne(5000)
                || className("ListView").findOne(5000);

            if (!prepared) {
                console.error("Share UI did not open (Timeout)");
                return false;
            }

            // 3. 搜索目标用户
            sleep(500);

            // 策略A: 直接在当前屏幕找 (最近聊天)
            // 也就是截图中看到的 "hhh", "Tink" 等
            let directTarget = text(who).visibleToUser(true).findOne(1000);
            if (directTarget) {
                console.log("Found target directly: " + who);
                click(directTarget.bounds().centerX(), directTarget.bounds().centerY());
            } else {
                // 策略B: 点击搜索
                // 截图中是顶部的一个搜索栏，里面有 "🔍 搜索"
                let searchBtn = text("搜索").findOne(2000)
                    || desc("搜索").findOne(2000)
                    || className("TextView").textContains("搜索").findOne(2000);

                if (searchBtn) {
                    click(searchBtn.bounds().centerX(), searchBtn.bounds().centerY());
                    sleep(1000);
                    setText(who);
                    sleep(1500);

                    // 搜索结果列表
                    let match = text(who).visibleToUser(true).findOne(3000) || textStartsWith(who).visibleToUser(true).findOne(3000);
                    if (match) {
                        click(match.bounds().centerX(), match.bounds().centerY());
                    } else {
                        console.error("Target not found in share search: " + who);
                        back(); sleep(500); back();
                        return false;
                    }
                } else {
                    console.error("Cannot find Search button in Share UI");
                    return false;
                }
            }

            sleep(500);
            let sendBtn = text("发送").findOne(3000) || className("Button").text("发送").findOne(3000) || textMatches("发送.*").findOne(2000);

            if (sendBtn) {
                sendBtn.click();
                sleep(500);
                return true;
            }
        } catch (e) {
            console.error("ShareVideoTo Error: " + e);
        }
        return false;
    },

    /**
     * 分享图片到指定会话 (Intent 方式)
     * 与 shareVideoTo 类似，但使用 image/* MIME 类型
     */
    shareImageTo(path, who) {
        try {
            // [Fix] Android 7.0+ FileUriExposedException Bypass
            importClass(android.os.StrictMode);
            var builder = new StrictMode.VmPolicy.Builder();
            StrictMode.setVmPolicy(builder.build());

            var file = new java.io.File(path);
            var uri = android.net.Uri.fromFile(file);

            app.startActivity({
                action: "android.intent.action.SEND",
                type: "image/*",
                packageName: "com.tencent.mm",
                className: "com.tencent.mm.ui.tools.ShareImgUI",
                extras: {
                    "android.intent.extra.STREAM": uri
                }
            });

            // Wait for share UI
            let prepared = text("选择一个聊天").findOne(5000)
                || text("创建新的聊天").findOne(5000)
                || text("最近聊天").findOne(5000)
                || textMatches(/.*选择.*/).findOne(5000)
                || className("ListView").findOne(5000);

            if (!prepared) {
                console.error("Share UI did not open (Timeout)");
                return false;
            }

            sleep(500);

            // Try to find target directly
            let directTarget = text(who).visibleToUser(true).findOne(1000);
            if (directTarget) {
                console.log("Found target directly: " + who);
                click(directTarget.bounds().centerX(), directTarget.bounds().centerY());
            } else {
                // Search for target
                let searchBtn = text("搜索").findOne(2000)
                    || desc("搜索").findOne(2000)
                    || className("TextView").textContains("搜索").findOne(2000);

                if (searchBtn) {
                    click(searchBtn.bounds().centerX(), searchBtn.bounds().centerY());
                    sleep(1000);
                    setText(who);
                    sleep(1500);

                    let match = text(who).visibleToUser(true).findOne(3000) || textStartsWith(who).visibleToUser(true).findOne(3000);
                    if (match) {
                        click(match.bounds().centerX(), match.bounds().centerY());
                    } else {
                        console.error("Target not found in share search: " + who);
                        back(); sleep(500); back();
                        return false;
                    }
                } else {
                    console.error("Cannot find Search button in Share UI");
                    return false;
                }
            }

            sleep(500);
            let sendBtn = text("发送").findOne(3000) || className("Button").text("发送").findOne(3000) || textMatches("发送.*").findOne(2000);

            if (sendBtn) {
                sendBtn.click();
                sleep(500);
                return true;
            }
        } catch (e) {
            console.error("ShareImageTo Error: " + e);
        }
        return false;
    }
}

const MessageObject = function (UIObject) {
    this.UIObject = UIObject

    /**
     * 获取所有文字
     * 
     * @returns [string]
     */
    this.getText = function () {
        let msgs = []
        let views = this.UIObject.find(className("TextView"))
        if (views.nonEmpty()) {
            views.forEach(item => {
                msgs.push(item.text())
            })
            if (this.isPhoto()) {
                msgs.push("图片")
            }
        }
        return msgs
    }

    /**
     * 获取聊天文字消息
     * 
     * @returns [string]
     */
    this.getMessage = function () {
        let msg1 = this.UIObject.findOne(className("TextView").depth(22))
        let msg2 = this.UIObject.findOne(className("TextView").depth(23))
        if (msg1) {
            return msg1.text()
        }
        if (msg2) {
            return msg2.text()
        }
        return ""
    }

    /**
     * 获取昵称
     * 
     * @returns string
     */
    this.getUser = function () {
        let avatar = this.UIObject.findOne(className("ImageView").depth(21)) || this.UIObject.findOne(className("ImageView").depth(22))
        if (avatar) {
            let user = avatar.desc()
            return user.replace("头像", "")
        }
        return ""
    }

    /**
     * 获取时间
     * 
     * @returns string
     */
    this.getTime = function () {
        let dt = this.UIObject.findOne(className("TextView").depth(19))
        if (dt) {
            return dt.text()
        }
        return ""
    }

    /**
     * 是否是语音消息
     * 
     * @returns boolean
     */
    this.voiceToText = function () {
        let toText = this.UIObject.findOne(className("RelativeLayout").depth(21))
        if (toText) {
            toText.click()
            sleep(random(500, 1000))
            return true
        }
        return false
    }

    /**
     * 是否是语音消息
     * 
     * @returns string
     */
    this.getVoiceText = function () {
        let voiceText = this.UIObject.findOne(className("RelativeLayout").depth(22))
        if (voiceText) {
            let rectText = voiceText.bounds()
            longClick(rectText.centerX(), rectText.centerY())
            sleep(random(500, 1000))
            click(rectText.left - 20, rectText.top - 50)
            sleep(random(500, 1000))
            let edit = className("EditText").findOnce()
            if (edit) {
                edit.click()
                edit.paste()
                sleep(random(500, 1000))
                let edit2 = className("EditText").findOnce()
                return edit2.text()
            }
        }
        return ""
    }

    /**
     * 是否是语音消息
     * 
     * @returns boolean
     */
    this.isVoice = function () {
        if (this.UIObject) {
            let voice = this.UIObject.find(descContains("语音"))
            return voice.nonEmpty()
        }
        return false; // Fallback
    }

    /**
     * 是否是图片
     * 
     * @returns boolean
     */
    this.isPhoto = function () {
        if (this.UIObject) {
            let photo = this.UIObject.find(descContains("图片"))
            return photo.nonEmpty()
        }
        return false;
    }

    /**
     * 保存图片
     * 
     * @returns boolean
     */
    this.savePhoto = function () {
        let photo = this.UIObject.findOnce(descContains("图片"))
        if (photo) {
            photo.parent().click()
            sleep(random(500, 1000))
            let save = className("FrameLayout").depth(20).drawingOrder(4).findOnce()
            if (save) {
                save.click()
                back()
                return true
            }
        }
        return false
    }

    /**
     * 提取图片中的文字
     * 
     * @returns string
     */
    this.getPhotoText = function () {
        let ocrs = []
        let photo = this.UIObject.findOnce(descContains("图片"))
        if (photo) {
            photo.parent().click()
            sleep(random(500, 1000))
            let more = className("FrameLayout").depth(20).drawingOrder(6).findOnce()
            if (more) {
                more.click()
                sleep(random(500, 1000))
                let ocr = text("提取文字").findOnce()
                if (ocr) {
                    ocr.parent().parent().click()
                    let ts = className("TextView").depth(18).find()
                    if (ts.nonEmpty()) {
                        ts.forEach(item => {
                            ocrs.push(item.text())
                        })
                        back()
                    }
                }
            }
            back()
        }
        return ocrs.join("")
    }

    /**
     * 是否是好友发送
     * 
     * @returns boolean
     */
    this.isFriend = function () {
        let avatar = this.UIObject.findOne(className("ImageView").depth(21))
        if (avatar) {
            let rect = avatar.bounds()
            return rect.left < 50
        }
        return false
    }

    /**
     * 是否是红包
     * 
     * @returns boolean
     */
    this.isRedPacket = function () {
        let redpacket = this.UIObject.find(textContains("红包"))
        return redpacket.nonEmpty()
    }
}
