#!/bin/bash
# ccswitch 开机启动 - 设置默认 Claude Code 配置
# 由 LaunchAgent 在登录时自动执行

cd /Users/luojun/projects/cw/模版/测试账套
/usr/bin/python3 switch_profile.py xiaoyudian >> /tmp/ccswitch-startup.log 2>&1
