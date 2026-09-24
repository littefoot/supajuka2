import urllib.request, json, re

def syllabify_word(w):
    w = re.sub(r'[^a-zA-Z]', '', w).lower()
    if not w:
        return [w]
    if len(w) <= 3:
        return [w]
    vowels = 'aeiouy'
    chunks = []
    cur = ''
    has_v = False
    for i, c in enumerate(w):
        cur += c
        if c in vowels:
            has_v = True
        elif has_v and i < len(w) - 1:
            chunks.append(cur)
            cur = ''
            has_v = False
    if cur:
        if chunks and not has_v:
            chunks[-1] += cur
        else:
            chunks.append(cur)
    return chunks or [w]

# Let's test the lines around California Love Dre verse:
lines = [
    (45.94, "Now let me welcome everybody to the Wild Wild West"),
    (48.81, "A state that's untouchable like Eliot Ness"),
    (52.69, "The track hits your eardrum like a slug to your chest"),
    (56.50, "Pack a vest for your Jimmy in the city of sex"), # real acoustic onset is 56.5
    (59.80, "We in that sunshine state where the bomb-ass hemp be"),
]

for i in range(len(lines)):
    start, text = lines[i]
    next_start = lines[i+1][0] if i+1 < len(lines) else start + 4.0
    gap = next_start - start
    words = text.split()
    word_syls = [syllabify_word(w) for w in words]
    total_syls = sum(len(s) for s in word_syls)
    
    # Singing duration budgeted within gap
    max_singing = max(0.5, gap - 0.20)
    # Target 0.30s per syl if space permits
    target_dur = total_syls * 0.32
    actual_dur = min(max_singing, target_dur)
    
    w_start = start
    word_timings = []
    for w, syls in zip(words, word_syls):
        w_dur = (len(syls) / total_syls) * actual_dur
        w_end = round(w_start + w_dur, 2)
        word_timings.append((w, round(w_start, 2), w_end))
        w_start = w_end
    
    print(f"[{i}] {start:.2f}s -> {word_timings[-1][2]:.2f}s (gap to next: {gap:.2f}s): '{text}'")
