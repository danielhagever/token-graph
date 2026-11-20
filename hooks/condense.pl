#!/usr/bin/perl
# Shrinks a transcript too big to read whole into the few fields transcript.ts
# needs: one short JSON line per main-chat response, typed prompt or compaction.
# Usage: perl condense.pl <transcript.jsonl>
use strict;
use warnings;

open(my $fh, '<', $ARGV[0]) or die "cannot open $ARGV[0]: $!";
while (my $l = <$fh>) {
  next if index($l, '"isSidechain":true') >= 0;
  if (index($l, '"subtype":"compact_boundary"') >= 0) {
    print qq({"type":"system","subtype":"compact_boundary"}\n);
    next;
  }
  if (index($l, '"type":"assistant"') >= 0) {
    my ($u) = $l =~ /"usage":\{(.*)/ or next;
    my ($id) = $l =~ /"id":"(msg_[^"]+)"/ or next;
    my ($model) = $l =~ /"model":"([^"]+)"/;
    my ($ts) = $l =~ /"timestamp":"([^"]+)"/;
    my %n;
    for my $k (qw(input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens)) {
      ($n{$k}) = $u =~ /"$k":(\d+)/;
      $n{$k} //= 0;
    }
    printf '{"type":"assistant","timestamp":"%s","message":{"id":"%s","model":"%s","usage":'
      . '{"input_tokens":%d,"output_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d}}}' . "\n",
      $ts // '', $id, $model // '', @n{qw(input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens)};
  } elsif (index($l, '"type":"user"') >= 0) {
    next if index($l, '"isMeta":true') >= 0 || index($l, '"isCompactSummary":true') >= 0;
    next if index($l, '"tool_result"') >= 0;
    next if $l =~ /"content":"<(?:local-)?command/;
    next unless $l =~ /"content":"/ || index($l, '"type":"text"') >= 0;
    print qq({"type":"user","message":{"content":"p"}}\n);
  }
}
