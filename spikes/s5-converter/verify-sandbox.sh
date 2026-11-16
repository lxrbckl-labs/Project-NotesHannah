#!/usr/bin/env bash
# Probe the sandbox from the inside. The flag list below MUST match run-sandboxed.sh.
set -u
cd "$(dirname "$0")"
IMAGE="${IMAGE:-s5-converter:spike}"
T="$(mktemp -d)"; mkdir "$T/out"; echo hello >"$T/in.bin"
flags=(--rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g,mode=1777
  --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --memory 2g --memory-swap 2g
  --cpus 2 --pids-limit 256 --ulimit nofile=1024:1024 --ulimit fsize=2147483648 --ulimit core=0 --ipc none
  -v "$T/in.bin":/input/file:ro -v "$T/out":/output:rw)
probe() { # name, shell snippet
  printf '%-34s ' "$1"; docker run "${flags[@]}" --entrypoint sh "$IMAGE" -c "$2" 2>&1 | tr '\n' ' ' | cut -c1-150; echo
}
probe "uid/gid"                    'id -u; id -g'
probe "capabilities (CapEff)"      'grep -E "^(CapEff|NoNewPrivs|Seccomp):" /proc/self/status | tr "\t\n" "  "'
probe "interfaces (net none)"      'ls /sys/class/net | tr "\n" " "'
probe "DNS lookup"                 'getent hosts example.com && echo RESOLVED || echo "dns blocked"'
probe "TCP 1.1.1.1:443"            'timeout 3 bash -c "echo > /dev/tcp/1.1.1.1/443" && echo CONNECTED || echo "tcp blocked"'
probe "TCP to host gateway"        'timeout 3 bash -c "echo > /dev/tcp/192.168.65.254/80" && echo CONNECTED || echo "tcp blocked"'
probe "write to / (/etc)"          'touch /etc/x 2>&1 | head -1'
probe "write to /opt/converter"    'touch /opt/converter/x 2>&1 | head -1'
probe "write to /tmp"              'touch /tmp/x && echo "tmp writable"'
probe "exec from /tmp (noexec)"    'cp /bin/true /tmp/t && /tmp/t && echo EXECUTED'
probe "write to input mount"       'echo x >> /input/file 2>&1 | head -1'
probe "write to /output"           'echo ok > /output/probe.txt && echo "output writable"'
probe "mount syscall"              'mount -t tmpfs x /mnt 2>&1 | head -1'
probe "setuid escalation (su)"     'su -c id root 2>&1 | head -1'
probe "docker socket / host paths" 'ls /var/run/docker.sock /Users /host 2>&1 | head -2'
probe "cpu.max / memory.max"       'cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max | tr "\n" " "'
probe "fork bomb (400 sleeps)"     'n=0; for i in $(seq 400); do sleep 4 & n=$((n+1)); done 2>&1 | tail -1; sleep 0.5; echo "spawned shells; pids in use: $(ls /proc | grep -c "^[0-9]")"'
printf '%-34s ' "memory hog (2g limit)"
docker run "${flags[@]}" --entrypoint node "$IMAGE" -e 'const a=[];for(;;)a.push(Buffer.alloc(50e6,1))' >/dev/null 2>&1; echo "exit=$? (137 = OOM-killed)"
printf '%-34s ' "tmpfs fill (1g limit)"
docker run "${flags[@]}" --entrypoint sh "$IMAGE" -c 'dd if=/dev/zero of=/tmp/big bs=1M count=1500 2>&1 | tail -1' 2>&1 | tr '\n' ' ' | cut -c1-150; echo
echo "host output dir listing after probes:"; ls "$T/out"; rm -rf "$T"
