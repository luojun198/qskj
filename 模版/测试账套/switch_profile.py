#!/usr/bin/env python3
import json, os, sys

# ===== 共享基础 =====
XIAOYUDIAN_BASE = {
    'ANTHROPIC_API_KEY': 'sk-1f480e341098508657b0efd995dfa51b',
    'ANTHROPIC_BASE_URL': 'http://47.251.57.178/',
}

YUDIAN_BASE = {
    'ANTHROPIC_API_KEY': 'sk-BN99gi9ZI5GiCklLFbKMu1TwoiPEKGgo5nYug2nU2uOpAeZw',
    'ANTHROPIC_BASE_URL': 'http://43.110.46.94/',
}

def make_env(base, model, sonnet_model=None, opus_model=None):
    m = sonnet_model or model
    o = opus_model or model
    return {**base,
        'ANTHROPIC_MODEL': model,
        'ANTHROPIC_DEFAULT_SONNET_MODEL': m,
        'ANTHROPIC_DEFAULT_OPUS_MODEL': o,
        'ANTHROPIC_DEFAULT_HAIKU_MODEL': m,
        'ANTHROPIC_SMALL_FAST_MODEL': m,
    }

# ===== 小雨点 (47.251.57.178) 可选模型 =====
xiaoyudian_models = {
    'sonnet-4-5': {
        'env': make_env(XIAOYUDIAN_BASE, 'claude-sonnet-4-5'),
        'model_key': 'sonnet', 'thinking': False, 'desc': 'sonnet-4-5'
    },
    'sonnet-4-6': {
        'env': make_env(XIAOYUDIAN_BASE, 'claude-sonnet-4-6'),
        'model_key': 'sonnet', 'thinking': False, 'desc': 'sonnet-4-6'
    },
    'opus-4-7': {
        'env': make_env(XIAOYUDIAN_BASE, 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-7'),
        'model_key': 'opus', 'thinking': True, 'desc': 'opus-4-7 + thinking'
    },
}

# ===== 雨点代理 (43.110.46.94) 可选模型 =====
yudian_models = {
    'opus-4-7': {
        'env': make_env(YUDIAN_BASE, 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-7'),
        'model_key': 'opus', 'thinking': True, 'desc': 'opus-4-7 + thinking'
    },
    'sonnet-4-6': {
        'env': make_env(YUDIAN_BASE, 'claude-sonnet-4-6'),
        'model_key': 'sonnet', 'thinking': False, 'desc': 'sonnet-4-6'
    },
    'opus-4-20250514': {
        'env': make_env(YUDIAN_BASE, 'claude-opus-4-20250514', 'claude-sonnet-4-6', 'claude-opus-4-20250514'),
        'model_key': 'opus', 'thinking': True, 'desc': 'opus-4-20250514 + thinking'
    },
    'gpt-5.5': {
        'env': make_env(YUDIAN_BASE, 'gpt-5.5'),
        'model_key': 'gpt-5.5', 'thinking': False, 'desc': 'gpt-5.5'
    },
}

# ===== 简写映射 =====
ALIASES = {
    'opus': 'opus-4-7',
    'opus47': 'opus-4-7',
    'sonnet': 'sonnet-4-6',
    'sonnet46': 'sonnet-4-6',
    'opus4': 'opus-4-20250514',
    'opus20250514': 'opus-4-20250514',
    'gpt': 'gpt-5.5',
    'gpt55': 'gpt-5.5'
}

ALL_MODELS = {
    **{f'xiaoyudian_{k}': v for k, v in xiaoyudian_models.items()},
    **{f'yudian_{k}': v for k, v in yudian_models.items()},
}

def write_settings(env, model_key, thinking):
    global_path = os.path.expanduser('~/.claude/settings.json')
    with open(global_path, 'r') as f:
        d = json.load(f)
    d['env'] = env
    d['model'] = model_key
    if thinking:
        d['enableThinking'] = True
    else:
        d.pop('enableThinking', None)
    with open(global_path, 'w') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)

    project_path = '.claude/settings.json'
    if os.path.exists(project_path):
        with open(project_path, 'r') as f:
            d = json.load(f)
        d['env'] = env
        d['model'] = model_key
        if thinking:
            d['enableThinking'] = True
        else:
            d.pop('enableThinking', None)
        with open(project_path, 'w') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python3 switch_profile.py <profile> [model]')
        print()
        print('Profile:')
        print('  xiaoyudian   小雨点 (47.251)')
        print('    可选模型: sonnet-4-5(默认), sonnet-4-6, opus-4-7')
        print('  yudian       雨点代理 (43.110)')
        print('    可选模型: opus-4-7(默认), sonnet-4-6, opus-4-20250514, gpt-5.5')
        print()
        print('简写: opus, sonnet, gpt, opus4')
        print('示例: python3 switch_profile.py xiaoyudian')
        print('      python3 switch_profile.py xiaoyudian opus-4-7')
        print('      python3 switch_profile.py yudian gpt')
        sys.exit(1)

    profile = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else None
    model = ALIASES.get(model, model) if model else None

    if profile == 'xiaoyudian':
        model = model or 'sonnet-4-5'
        if model not in xiaoyudian_models:
            print(f'未知模型: {model}')
            print(f'可用: {list(xiaoyudian_models.keys())}')
            sys.exit(1)
        cfg = xiaoyudian_models[model]
        write_settings(cfg['env'], cfg['model_key'], cfg['thinking'])
        print(f'现在使用: 小雨点 (47.251 / {cfg["desc"]})')

    elif profile == 'yudian':
        model = model or 'opus-4-7'
        if model not in yudian_models:
            print(f'未知模型: {model}')
            print(f'可用: {list(yudian_models.keys())}')
            sys.exit(1)
        cfg = yudian_models[model]
        write_settings(cfg['env'], cfg['model_key'], cfg['thinking'])
        print(f'现在使用: 雨点代理 (43.110 / {cfg["desc"]})')

    else:
        print(f'未知 profile: {profile}')
        print('可用: xiaoyudian, yudian')
        sys.exit(1)
