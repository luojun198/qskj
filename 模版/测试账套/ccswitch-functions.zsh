# ===== Claude Code 配置切换 (ccswitch) =====
SWITCH_SCRIPT="$HOME/projects/cw/模版/测试账套/switch_profile.py"

# ===== 小雨点 (47.251.57.178) =====

# 小雨点默认 sonnet-4-5
function toxiao() {
    python3 "$SWITCH_SCRIPT" xiaoyudian
}
function xiaoyudian() {
    python3 "$SWITCH_SCRIPT" xiaoyudian
}

# 小雨点 sonnet-4-5
function sonnet() {
    python3 "$SWITCH_SCRIPT" xiaoyudian sonnet-4-5
}
function sonnet45() {
    python3 "$SWITCH_SCRIPT" xiaoyudian sonnet-4-5
}

# 小雨点 sonnet-4-6
function sonnet46() {
    python3 "$SWITCH_SCRIPT" xiaoyudian sonnet-4-6
}

# 小雨点 opus-4-7 + thinking
function xiao-opus() {
    python3 "$SWITCH_SCRIPT" xiaoyudian opus-4-7
}

# ===== 雨点代理 (43.110.46.94) =====

# 雨点默认 opus-4-7 + thinking
function toyu() {
    python3 "$SWITCH_SCRIPT" yudian "$1"
}
function opus() {
    python3 "$SWITCH_SCRIPT" yudian opus
}
function opus47() {
    python3 "$SWITCH_SCRIPT" yudian opus
}

# 雨点 sonnet-4-6
function toyu-sonnet() {
    python3 "$SWITCH_SCRIPT" yudian sonnet-4-6
}

# 雨点 opus-4-20250514 + thinking
function opus4() {
    python3 "$SWITCH_SCRIPT" yudian opus4
}
function toyu-opus4() {
    python3 "$SWITCH_SCRIPT" yudian opus4
}

# 雨点 gpt-5.5
function gpt() {
    python3 "$SWITCH_SCRIPT" yudian gpt
}
function gpt55() {
    python3 "$SWITCH_SCRIPT" yudian gpt
}
function toyu-gpt() {
    python3 "$SWITCH_SCRIPT" yudian gpt
}

# ===== 查看配置 & 菜单 =====
function ccshow() {
    echo "===== 全局配置 (~/.claude/settings.json) ====="
    python3 -c "
import json
with open('$HOME/.claude/settings.json', 'r') as f:
    d = json.load(f)
env = d.get('env', {})
print('  API端点:', env.get('ANTHROPIC_BASE_URL', '-'))
print('  模型:', d.get('model', '-'))
print('  Thinking:', d.get('enableThinking', False))
print('  Model env:', env.get('ANTHROPIC_MODEL', '-'))
"
    if [ -f .claude/settings.json ]; then
        echo "===== 项目配置 (.claude/settings.json) ====="
        python3 -c "
import json
with open('.claude/settings.json', 'r') as f:
    d = json.load(f)
env = d.get('env', {})
print('  API端点:', env.get('ANTHROPIC_BASE_URL', '-'))
print('  模型:', d.get('model', '-'))
print('  Thinking:', d.get('enableThinking', False))
print('  Model env:', env.get('ANTHROPIC_MODEL', '-'))
"
    fi
    menu
}

function m() { menu }

function menu() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║       Claude Code 模型切换菜单               ║"
    echo "╠═══════════════════════════════════════════════╣"
    echo "║  【小雨点 47.251.57.178】                     ║"
    echo "║  sonnet / toxiao   sonnet-4-5                ║"
    echo "║  sonnet46          sonnet-4-6                ║"
    echo "║  xiao-opus         opus-4-7+thinking         ║"
    echo "║                                               ║"
    echo "║  【雨点代理 43.110.46.94】                    ║"
    echo "║  opus / toyu       opus-4-7+thinking         ║"
    echo "║  toyu-sonnet       sonnet-4-6                ║"
    echo "║  opus4             opus-4-20250514+thinking   ║"
    echo "║  gpt               gpt-5.5                   ║"
    echo "║                                               ║"
    echo "║  m                显示此菜单                  ║"
    echo "║  ccshow           查看当前配置                ║"
    echo "╚═══════════════════════════════════════════════╝"
}
